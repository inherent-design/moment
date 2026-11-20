import * as core from './semantic-core.mjs';
import {canonical,bytesDigest,fail} from './json.mjs';

export const storageVersion=2;
const auxiliaryColumns={
  metadata:['key','value'],receipts:['principal_id','context_id','method','key','digest','response','commit_value'],
  events:['context_id','sequence','event_id','value'],outbox:['context_id','execution_id','value'],imports:['id','digest','value']
};
export function assertEmptyKernel(db) {
  if(db.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get())
    fail('UNSUPPORTED_VERSION','Unversioned nonempty kernel storage requires inspection; no schema was initialized');
}
export function assertKernelLayout(db,{legacy=false}={}) {
  const columns={...auxiliaryColumns,...(legacy?{snapshots:['context_id','revision','value']}:{snapshot_values:['id','digest','bytes'],context_revisions:['context_id','revision','manifest','digest']})};
  const tables=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
  if(canonical(tables)!==canonical(Object.keys(columns).sort()))fail('UNSUPPORTED_VERSION','Kernel storage tables require inspection before use or conversion');
  for(const [table,names] of Object.entries(columns))if(canonical(db.prepare('PRAGMA table_xinfo('+table+')').all().map(row=>row.name))!==canonical(names))
    fail('UNSUPPORTED_VERSION','Kernel '+table+' columns do not match the consumed storage contract');
  if(db.prepare("SELECT 1 FROM sqlite_schema WHERE type IN ('trigger','view') OR (type='index' AND sql IS NOT NULL) LIMIT 1").get())
    fail('UNSUPPORTED_VERSION','Kernel storage has additional triggers, views or explicit indexes requiring inspection');
}
export function assertStorageFormat(db) {
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(core.storageFormat('kernel',version)!=='StorageCurrent') fail('UNSUPPORTED_VERSION',`Snapshot storage format ${version} does not match this implementation`);
}
const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const objectId=value=>Number.isSafeInteger(value) && value>0;
const conflict=message=>fail('IDENTITY_CONFLICT',message);

/** Private representation. Domain digests and identifiers stay inside exact values. */
export function createSnapshotTables(db) {
  db.exec(`
    CREATE TABLE snapshot_values(id INTEGER PRIMARY KEY,digest TEXT NOT NULL UNIQUE,bytes TEXT NOT NULL);
    CREATE TABLE context_revisions(context_id TEXT NOT NULL,revision INTEGER NOT NULL,manifest TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(context_id,revision));
  `);
}

function shape(snapshot,contextId=snapshot?.context?.id,revision=snapshot?.context?.revision) {
  if(!plain(snapshot) || Object.keys(snapshot).sort().join(',')!=='assertions,context,controlState,records' ||
    !plain(snapshot.context) || snapshot.context.id!==contextId || snapshot.context.revision!==revision ||
    typeof contextId!=='string' || !contextId.length || !Number.isSafeInteger(revision) || revision<1 ||
    !Array.isArray(snapshot.records) || !Array.isArray(snapshot.assertions) || !plain(snapshot.controlState) ||
    Object.values(snapshot.controlState).some(value=>!plain(value))) conflict('Snapshot shape or revision identity is incompatible');
}
const parse=(bytes,label)=>{
  try{return JSON.parse(bytes);}
  catch {conflict(label+' is not valid JSON');}
};

/** Caller owns the same write transaction as events, receipts and outbox. */
export function writeSnapshot(db,snapshot) {
  if(!db.isTransaction) fail('INTERNAL','Snapshot publication requires its owning transaction');
  assertStorageFormat(db);
  shape(snapshot);
  const find=db.prepare('SELECT id,bytes FROM snapshot_values WHERE digest=?');
  const insert=db.prepare('INSERT INTO snapshot_values(digest,bytes) VALUES (?,?)');
  const put=value=>{
    const bytes=canonical(value),hash=bytesDigest(bytes),prior=find.get(hash);
    if(prior) {
      if(prior.bytes!==bytes) conflict('Pooled value digest conflicts with retained bytes');
      return prior.id;
    }
    const id=insert.run(hash,bytes).lastInsertRowid;
    if(!objectId(id)) conflict('Pooled value identity exceeds supported integer bounds');
    return id;
  };
  const manifest={
    version:1,context:put(snapshot.context),
    records:snapshot.records.map(put),assertions:snapshot.assertions.map(put),
    controlState:Object.fromEntries(Object.entries(snapshot.controlState).map(([namespace,values])=>[
      namespace,Object.fromEntries(Object.entries(values).map(([key,value])=>[key,put(value)]))
    ]))
  };
  const bytes=canonical(manifest);
  db.prepare('INSERT INTO context_revisions VALUES (?,?,?,?)')
    .run(snapshot.context.id,snapshot.context.revision,bytes,bytesDigest(bytes));
}

/** A root and all referenced bytes are read from one SQLite snapshot. */
export function readSnapshot(db,contextId,revision) {
  const own=!db.isTransaction;
  if(own) db.exec('BEGIN');
  try {
    assertStorageFormat(db);
    const row=revision===undefined
      ?db.prepare('SELECT revision,manifest,digest FROM context_revisions WHERE context_id=? ORDER BY revision DESC LIMIT 1').get(contextId)
      :db.prepare('SELECT revision,manifest,digest FROM context_revisions WHERE context_id=? AND revision=?').get(contextId,revision);
    if(!row) fail('NOT_FOUND','Context snapshot not found');
    if(typeof row.manifest!=='string' || bytesDigest(row.manifest)!==row.digest) conflict('Snapshot manifest integrity does not match');
    const manifest=parse(row.manifest,'Snapshot manifest');
    if(!plain(manifest) || Object.keys(manifest).sort().join(',')!=='assertions,context,controlState,records,version' ||
      manifest.version!==1 || !Array.isArray(manifest.records) || !Array.isArray(manifest.assertions) ||
      !plain(manifest.controlState) || Object.values(manifest.controlState).some(value=>!plain(value))) {
      conflict('Snapshot manifest representation is incompatible');
    }
    const ids=[...new Set([manifest.context,...manifest.records,...manifest.assertions,
      ...Object.values(manifest.controlState).flatMap(values=>Object.values(values))])];
    if(ids.some(id=>!objectId(id))) conflict('Snapshot contains an invalid private value reference');
    const rows=db.prepare('SELECT id,digest,bytes FROM snapshot_values WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids));
    if(rows.length!==ids.length) conflict('Snapshot references unavailable pooled values');
    const values=new Map();
    for(const value of rows) {
      if(typeof value.bytes!=='string' || bytesDigest(value.bytes)!==value.digest) conflict('Referenced pooled value integrity does not match');
      values.set(value.id,value.bytes);
    }
    // Each occurrence is parsed independently: equal bytes must not create
    // mutable aliases between logical values or between historical reads.
    const get=id=>parse(values.get(id),'Referenced pooled value');
    const snapshot={
      context:get(manifest.context),records:manifest.records.map(get),assertions:manifest.assertions.map(get),
      controlState:Object.fromEntries(Object.entries(manifest.controlState).map(([namespace,entries])=>[
        namespace,Object.fromEntries(Object.entries(entries).map(([key,id])=>[key,get(id)]))
      ]))
    };
    shape(snapshot,contextId,row.revision);
    if(own) db.exec('COMMIT');
    return snapshot;
  } catch(error) {
    if(own) try{db.exec('ROLLBACK');}catch{}
    throw error;
  }
}
