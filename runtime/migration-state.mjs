import {join} from 'node:path';
import {readPrivateJson} from './private-files.mjs';
import {fail} from './json.mjs';

export const migrationJournal=root=>join(root,'runtime/storage-migration.json');
export function assertMigrationReady(root) {
  let journal;try{journal=readPrivateJson(migrationJournal(root),262144);}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(journal?.formatVersion!==1 || journal.stage!=='complete')fail('CAPABILITY_UNAVAILABLE','A retained storage migration requires forward recovery before service startup; use moment storage resume. Preserve its journal and backups.');
}
