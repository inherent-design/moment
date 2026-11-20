import { mkdtempSync,mkdirSync,realpathSync,lstatSync,readFileSync,writeFileSync,unlinkSync,rmdirSync,rmSync,renameSync,openSync,closeSync,fsyncSync,chmodSync,accessSync,fstatSync,readSync,constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname,basename,isAbsolute,resolve,delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { bytesDigest,canonical,digest,fail,DomainError,resultError } from './json.mjs';
import { publishPrivate } from './private-files.mjs';
import { catalogIdentity } from './bindings.mjs';
import {observeCodexVersion,codexApiError} from './codex-api.mjs';

const optionalStat=path=>{try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return;throw error;}};
function canonicalRoot(path) {
  if(typeof path!=='string' || !isAbsolute(path) || /[\r\n\0]/.test(path)) fail('INVALID_ARGUMENT','Select explicit absolute Codex and Moment roots');
  let parent=resolve(path),suffix=[];
  while(!optionalStat(parent)) {suffix.unshift(basename(parent));parent=dirname(parent);}
  const stat=lstatSync(parent);
  if(!stat.isDirectory() && !stat.isSymbolicLink()) fail('INVALID_ARGUMENT','Selected root is not a directory');
  return join(realpathSync(parent),...suffix);
}
function snapshot(path,privateFile=false) {
  const prior=optionalStat(path);
  if(!prior) return {exists:false,digest:null,bytes:''};
  if(prior.isSymbolicLink()) fail('FORBIDDEN','Integration custody cannot follow file links');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=fstatSync(fd);
    if(!stat.isFile() || stat.uid!==process.getuid() || stat.size>1048576 || privateFile && stat.mode&0o077) fail('FORBIDDEN','Integration custody must use bounded owned regular files');
    const buffer=Buffer.alloc(1048577);let length=0,read;
    while(length<buffer.length && (read=readSync(fd,buffer,length,buffer.length-length,null))>0) length+=read;
    if(length>1048576) fail('LIMIT_EXCEEDED','Integration file exceeds 1 MiB');
    const final=fstatSync(fd);
    if(prior.dev!==stat.dev || prior.ino!==stat.ino || stat.size!==final.size || stat.mtimeMs!==final.mtimeMs || stat.ctimeMs!==final.ctimeMs) fail('IDENTITY_CONFLICT','Integration file changed while observed; inspect it before retrying','reconcile');
    const bytes=new TextDecoder('utf8',{fatal:true}).decode(buffer.subarray(0,length));
    return {exists:true,digest:bytesDigest(bytes),bytes,identity:{device:stat.dev,inode:stat.ino,mtime:stat.mtimeMs,ctime:stat.ctimeMs,size:stat.size,mode:stat.mode&0o777}};
  } finally {closeSync(fd);}
}
const sameSnapshot=(a,b)=>a.exists===b.exists && a.digest===b.digest && canonical(a.identity??null)===canonical(b.identity??null);
function replacement(path,bytes,mode=0o600,beforePublish=()=>{}) {
  const temporary=join(dirname(path),'.moment-'+randomUUID()+'.writing');
  try {
    publishPrivate(temporary,bytes);
    // Preserve the user's existing mode without widening a previously private file.
    if(mode!==0o600) chmodSync(temporary,mode);
    beforePublish();
    renameSync(temporary,path);
    const fd=openSync(dirname(path),constants.O_RDONLY);try{fsyncSync(fd);}finally{closeSync(fd);}
  } finally {if(optionalStat(temporary)) unlinkSync(temporary);}
}

function difference(before,after) {
  let start=0,end=0;
  while(start<before.length && start<after.length && before[start]===after[start]) start++;
  while(end<before.length-start && end<after.length-start && before[before.length-1-end]===after[after.length-1-end]) end++;
  return {removed:before.slice(start,before.length-end),added:after.slice(start,after.length-end)};
}
const block=value=>value.trim()+'\n';
function ownedDelta(before,after) {
  const delta=difference(before,after);
  if(delta.added.trim() || !delta.removed.includes('[mcp_servers.moment]')) fail('IDENTITY_CONFLICT','Codex changed bytes beyond the owned Moment registration; preserve and inspect the configuration');
  for(const line of delta.removed.split('\n')) if(line.trim().startsWith('[') && !['[mcp_servers.moment]','[mcp_servers.moment.env]'].includes(line.trim())) fail('IDENTITY_CONFLICT','Removal crosses another configuration section');
  return block(delta.removed);
}
function installedCodex() {
  const path=(process.env.PATH??'').split(delimiter).map(p=>join(p,'codex')).find(path=>{try{accessSync(path,constants.X_OK);return true;}catch{return false;}});
  if(!path) fail('CAPABILITY_UNAVAILABLE','Installed Codex is unavailable; configuration was not changed');
  return realpathSync(path);
}

/** Supported Codex commands own TOML. All work here is in disposable private roots. */
export function stageCodexConfig({before,action,launcher,ownedBlock}) {
  const binary=installedCodex();
  const root=realpathSync(mkdtempSync(join(tmpdir(),'moment-config-'))),state=join(root,'codex');
  mkdirSync(state,{mode:0o700});const config=join(state,'config.toml');writeFileSync(config,before,{mode:0o600});
  const env={PATH:process.env.PATH??'',HOME:root,CODEX_HOME:state,XDG_CONFIG_HOME:join(root,'config'),XDG_DATA_HOME:join(root,'data'),XDG_CACHE_HOME:join(root,'cache'),XDG_RUNTIME_DIR:join(root,'run')};
  const version=observeCodexVersion(binary,{cwd:root,env});
  const run=(args,json=false)=>{
    const boundary=args[0]==='mcp'?'mcp '+args[1]:'configuration command';
    let output;
    try{output=execFileSync(binary,args,{cwd:root,env,encoding:'utf8',timeout:15000,maxBuffer:1048576,stdio:['ignore','pipe','pipe']});}
    catch{throw codexApiError(boundary,'the selected staging command; target configuration was not changed',version);}
    if(!json)return output;
    let value;try{value=JSON.parse(output)}catch{throw codexApiError(boundary,'a JSON configuration response; target configuration was not changed',version);}
    if(args[1]==='list' && (!Array.isArray(value) || value.some(entry=>!entry || typeof entry.name!=='string')) || args[1]==='get' && (!value || typeof value!=='object' || Array.isArray(value) || value.name!=='moment' || value.transport?.type!=='stdio'))throw codexApiError(boundary,'the consumed configuration fields; target configuration was not changed',version);
    return value;
  };
  try {
    const listed=run(['mcp','list','--json'],true);
    const present=listed.some(entry=>entry.name==='moment');
    let currentEntry,currentBlock,without=before;
    if(present) {
      currentEntry=run(['mcp','get','moment','--json'],true);
      if(ownedBlock && before.indexOf(ownedBlock)>=0 && before.indexOf(ownedBlock)===before.lastIndexOf(ownedBlock)) {
        currentBlock=ownedBlock;without=before.replace(ownedBlock,'');
        writeFileSync(config,without,{mode:0o600});
        if(canonical(run(['mcp','list','--json'],true))!==canonical(listed.filter(entry=>entry.name!=='moment'))) fail('IDENTITY_CONFLICT','Owned entry removal changed the parsed server inventory; preserve the configuration');
      } else {
        run(['mcp','remove','moment']);without=readFileSync(config,'utf8');currentBlock=ownedDelta(before,without);
      }
    }
    if(action==='disconnect') return {after:without,present,currentEntry,currentBlock,version};
    // Generate only our entry in empty staging. Codex may normalize unrelated
    // nested tables when editing a complete configuration; never publish that.
    writeFileSync(config,'',{mode:0o600});
    const args=['mcp','add','moment'];
    for(const [key,value] of Object.entries(launcher.env)) args.push('--env',`${key}=${value}`);
    run([...args,'--',launcher.command,...launcher.args]);
    const generated=readFileSync(config,'utf8'),entry=run(['mcp','get','moment','--json'],true);
    run(['mcp','remove','moment']);
    if(readFileSync(config,'utf8')!=='') fail('IDENTITY_CONFLICT','Codex staging did not isolate the owned entry; inspect before applying');
    const entryBlock=(without && !without.endsWith('\n')?'\n':'')+ownedDelta(generated,''),after=without+entryBlock;
    writeFileSync(config,after,{mode:0o600});
    if(canonical(run(['mcp','get','moment','--json'],true))!==canonical(entry) || canonical(run(['mcp','list','--json'],true).filter(item=>item.name!=='moment'))!==canonical(listed.filter(item=>item.name!=='moment'))) fail('IDENTITY_CONFLICT','Combined configuration changed the parsed server inventory; preserve the configuration');
    return {after,present,currentEntry,currentBlock,entry,entryBlock,version};
  } finally {rmSync(root,{recursive:true,force:true});}
}

function acquireLock(path) {
  // SQLite supplies the cross-process guard while PID/nonce files retain
  // inspectable custody. Reclaiming a stale directory alone is not a CAS.
  const guardPath=path+'.sqlite',fd=openSync(guardPath,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  const stat=fstatSync(fd);closeSync(fd);
  if(!stat.isFile() || stat.uid!==process.getuid() || stat.mode&0o077) fail('FORBIDDEN','Installer guard must be a private owned file');
  const guard=new DatabaseSync(guardPath);
  try {guard.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');}
  catch(error) {guard.close();if([5,6].includes(error.errcode&255)) fail('IDENTITY_CONFLICT','Another installer holds the integration transaction; wait and retry');throw error;}
  const close=()=>{try{guard.exec('ROLLBACK');}finally{guard.close();}};
  try {
  const owner={formatVersion:1,pid:process.pid,nonce:randomUUID()};
  try {mkdirSync(path,{mode:0o700});}
  catch(error) {
    if(error.code!=='EEXIST') throw error;
    const lock=lstatSync(path);
    if(!lock.isDirectory() || lock.isSymbolicLink() || lock.uid!==process.getuid() || lock.mode&0o077) fail('FORBIDDEN','Integration lock must be a private owned directory');
    const record=snapshot(join(path,'owner.json'),true);
    if(!record.exists) fail('OUTCOME_UNKNOWN','Integration lock has insufficient ownership evidence; preserve it for inspection','reconcile');
    const prior=JSON.parse(record.bytes);
    if(prior.formatVersion!==1 || !Number.isSafeInteger(prior.pid) || prior.pid<1 || typeof prior.nonce!=='string') fail('OUTCOME_UNKNOWN','Integration lock ownership is invalid; preserve it for inspection','reconcile');
    try {process.kill(prior.pid,0);fail('IDENTITY_CONFLICT','Another installer holds the integration lock; wait and retry');}
    catch(error) {if(error.code!=='ESRCH') throw error;}
    if(!sameSnapshot(record,snapshot(join(path,'owner.json'),true))) fail('IDENTITY_CONFLICT','Integration lock changed during inspection');
    unlinkSync(join(path,'owner.json'));rmdirSync(path);mkdirSync(path,{mode:0o700});
  }
  publishPrivate(join(path,'owner.json'),canonical(owner)+'\n');
  return ()=>{try {const record=JSON.parse(snapshot(join(path,'owner.json'),true).bytes);if(record.nonce!==owner.nonce) fail('IDENTITY_CONFLICT','Integration lock changed; preserve it');unlinkSync(join(path,'owner.json'));rmdirSync(path);}finally{close();}};
  } catch(error) {close();throw error;}
}

/** Explicit host operation; never exposed as a model tool. Preview is observational. */
export function createIntegration({stage=stageCodexConfig,onPhase=async()=>{},credentialFile=process.env.MOMENT_CREDENTIAL_FILE}={}) {
  async function reconcile(request) {
    let release;
    try {
      if(!request || !['connect','disconnect'].includes(request.action) || typeof request.apply!=='boolean' || Object.keys(request).some(k=>!['action','codexHome','momentHome','apply'].includes(k))) fail('INVALID_ARGUMENT','Use connect/disconnect with explicit roots and an apply boolean');
      const codexHome=canonicalRoot(request.codexHome),momentHome=canonicalRoot(request.momentHome),target=join(codexHome,'config.toml');
      const directory=join(momentHome,'integrations/codex',digest(codexHome).slice(7)),receiptPath=join(directory,'receipt.json'),journalPath=join(directory,'pending.json');
      const outcome=(state,reason,extra={})=>({ok:true,value:{state,reason,target,...extra}});
      const conflict=reason=>outcome('conflict',reason);
      for(const part of [momentHome,join(momentHome,'integrations'),join(momentHome,'integrations/codex'),directory]) {
        if(request.apply && !optionalStat(part)) mkdirSync(part,{recursive:true,mode:0o700});
        const stat=optionalStat(part);
        if(stat && (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid() || stat.mode&(part===momentHome?0o022:0o077))) fail('FORBIDDEN','Integration directories must have owned custody without linked receipt paths');
      }
      if(request.apply) {
        release=acquireLock(join(directory,'transaction.lock'));
      }
      let recovered=false;
      const pending=snapshot(journalPath,true);
      if(pending.exists) {
        if(!request.apply) return outcome('recovery_required','An interrupted integration needs apply in these same explicit roots; preview has no effects');
        const journal=JSON.parse(pending.bytes),current=snapshot(target),actualReceipt=snapshot(receiptPath,true);
        if(journal.formatVersion!==1 || journal.target!==target || journal.momentHome!==momentHome || !['connect','disconnect'].includes(journal.action)) return outcome('recovery_required','Journal identity is invalid; preserve it for inspection');
        const desiredReceipt=journal.receipt?bytesDigest(canonical(journal.receipt)+'\n'):null;
        if(!sameSnapshot(actualReceipt,journal.receiptBefore) && !(actualReceipt.exists===!!journal.receipt && actualReceipt.digest===desiredReceipt)) return outcome('recovery_required','Ownership changed around an interrupted publication; preserve it for inspection');
        if(current.exists===journal.after.exists && current.digest===journal.after.digest) {
          const revalidate=()=>{if(!sameSnapshot(current,snapshot(target)) || !sameSnapshot(actualReceipt,snapshot(receiptPath,true))) fail('IDENTITY_CONFLICT','Recovery custody changed before publication; preserve the journal','reconcile');};
          if(journal.receipt) replacement(receiptPath,canonical(journal.receipt)+'\n',0o600,revalidate);
          else if(optionalStat(receiptPath)) {revalidate();unlinkSync(receiptPath);}
          unlinkSync(journalPath);recovered=true;
        } else if(sameSnapshot(current,journal.before) && sameSnapshot(actualReceipt,journal.receiptBefore)) {
          unlinkSync(journalPath);recovered=true;
        } else return outcome('recovery_required','Configuration changed around an interrupted publication; preserve the journal and inspect it before retrying');
      }
      const before=snapshot(target),receiptSnapshot=snapshot(receiptPath,true),receipt=receiptSnapshot.exists?JSON.parse(receiptSnapshot.bytes):undefined;
      if(receipt && (receipt.formatVersion!==1 || receipt.codexHome!==codexHome || receipt.momentHome!==momentHome || receipt.entryDigest!==bytesDigest(receipt.entryBlock))) return conflict('Owned registration receipt does not match these roots; inspect its custody');
      const launcher={command:realpathSync(process.execPath),args:[new URL('./cli.mjs',import.meta.url).pathname,'mcp'],env:{MOMENT_HOME:momentHome,MOMENT_CATALOG_REVISION:catalogIdentity.digest,...(credentialFile?{MOMENT_CREDENTIAL_FILE:canonicalRootFile(credentialFile)}:{})}};
      if(request.action==='connect' && process.version!=='v26.13.0') fail('UNSUPPORTED_VERSION','Run the pinned Node 26.13.0 runtime before generating an installation launcher');
      const plan=await stage({before:before.bytes,action:request.action,launcher,ownedBlock:receipt?.entryBlock});
      if(plan.present && (!receipt || receipt.entryDigest!==bytesDigest(plan.currentBlock) || receipt.configEntryDigest!==digest(plan.currentEntry))) return conflict('A preexisting or edited Moment entry is not the unchanged owned registration; preserve and inspect it');
      if(!plan.present && receipt) return conflict('Owned receipt exists but its registration is missing; inspect the external change');
      if(request.action==='disconnect' && !plan.present) return outcome(recovered?'applied':'unchanged',recovered?'Interrupted publication recovered; Moment is disconnected':'Moment is already disconnected');
      const afterExists=!(request.action==='disconnect' && receipt?.createdConfig && plan.after.length===0);
      const after={exists:afterExists,digest:afterExists?bytesDigest(plan.after):null};
      const nextReceipt=request.action==='connect'?{formatVersion:1,codexHome,momentHome,entryBlock:plan.entryBlock,entryDigest:bytesDigest(plan.entryBlock),configEntryDigest:digest(plan.entry),launcher,catalog:catalogIdentity,codexVersion:plan.version,createdConfig:receipt?.createdConfig??!before.exists}:undefined;
      const extra={...(before.digest?{beforeDigest:before.digest}:{}),...(after.digest?{afterDigest:after.digest}:{}),launcher,...(nextReceipt?{ownedEntryDigest:nextReceipt.entryDigest,ownedEntry:{text:nextReceipt.entryBlock,digest:nextReceipt.entryDigest}}:receipt?{ownedEntryDigest:receipt.entryDigest}:{})};
      const unchanged=before.exists===after.exists && before.digest===after.digest && canonical(receipt??null)===canonical(nextReceipt??null);
      if(unchanged) return outcome(recovered?'applied':'unchanged',recovered?'Interrupted publication recovered; registration matches':'Owned registration already matches',extra);
      await onPhase('planned',{target});
      if(!request.apply) return outcome('planned','Preview only. Apply requires quiet configuration while Moment revalidates its expected-old identity and content',extra);
      if(!sameSnapshot(before,snapshot(target)) || !sameSnapshot(receiptSnapshot,snapshot(receiptPath,true))) return conflict('Configuration or ownership changed during planning; no publication was attempted');
      const journal={formatVersion:1,target,momentHome,action:request.action,before:{...before},receiptBefore:{...receiptSnapshot},after,receipt:nextReceipt??null};
      delete journal.before.bytes;delete journal.receiptBefore.bytes;
      publishPrivate(journalPath,canonical(journal)+'\n');await onPhase('journaled',{target});
      if(!sameSnapshot(before,snapshot(target)) || !sameSnapshot(receiptSnapshot,snapshot(receiptPath,true))) return outcome('recovery_required','Configuration changed after journaling; preserve the journal and inspect it before retrying');
      mkdirSync(codexHome,{recursive:true,mode:0o700});
      const revalidate=()=>{if(!sameSnapshot(before,snapshot(target)) || !sameSnapshot(receiptSnapshot,snapshot(receiptPath,true))) fail('IDENTITY_CONFLICT','Configuration changed immediately before publication; preserve the journal and inspect it','reconcile');};
      if(after.exists) replacement(target,plan.after,before.identity?.mode??0o600,revalidate);else {revalidate();unlinkSync(target);}
      await onPhase('config-published',{target});
      if(snapshot(target).exists!==after.exists || snapshot(target).digest!==after.digest || !sameSnapshot(receiptSnapshot,snapshot(receiptPath,true))) return outcome('recovery_required','Configuration or ownership changed after publication; inspect the retained journal');
      const observedAfter=snapshot(target);
      const revalidateReceipt=()=>{if(!sameSnapshot(observedAfter,snapshot(target)) || !sameSnapshot(receiptSnapshot,snapshot(receiptPath,true))) fail('IDENTITY_CONFLICT','Custody changed before the ownership receipt was published; preserve the journal','reconcile');};
      if(nextReceipt) replacement(receiptPath,canonical(nextReceipt)+'\n',0o600,revalidateReceipt);else {revalidateReceipt();unlinkSync(receiptPath);}
      await onPhase('receipt-published',{target});unlinkSync(journalPath);
      return outcome('applied',request.action==='connect'?'Moment registration saved in the explicit target; reload that client when ready':'Owned Moment registration removed; runtime state and shared service are unchanged',extra);
    } catch(error) {
      if(error instanceof DomainError) return resultError(error);
      return {ok:false,error:{code:'OUTCOME_UNKNOWN',message:'Integration did not finish; inspect the explicit target and retained private journal before retrying',retry:'reconcile',details:null}};
    } finally {if(release) try{release();}catch{return {ok:false,error:{code:'OUTCOME_UNKNOWN',message:'Integration lock custody changed; inspect the target and retained recovery state',retry:'reconcile',details:null}};}}
  }
  return {reconcile};
}
function canonicalRootFile(path) {
  if(typeof path!=='string' || !isAbsolute(path) || /[\r\n\0]/.test(path)) fail('INVALID_ARGUMENT','Credential locator must be an explicit absolute file path');
  const parent=canonicalRoot(dirname(path));return join(parent,basename(path));
}
