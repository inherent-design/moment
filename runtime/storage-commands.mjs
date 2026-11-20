import {inspectHome} from './home.mjs';
import {argumentsFor} from './commands.mjs';
import {readJsonInput} from './input.mjs';
import {publishPrivate,readPrivateJson} from './private-files.mjs';
import {migrationJournal} from './migration-state.mjs';
import {planStorage,migrateStorage} from './storage-maintenance.mjs';
import {canonical,fail} from './json.mjs';
import {resolve} from 'node:path';

export async function runStorageCommand(args) {
  try {
    const [operation,...rest]=args,{options,positionals}=argumentsFor(rest,['--file','--enroll','--out'],['--json']);
    const allowed={plan:['--enroll','--out','--json'],migrate:['--file','--json'],resume:['--json']};
    if(positionals.length || !allowed[operation] || Object.keys(options).some(key=>!allowed[operation].includes(key)))fail('INVALID_ARGUMENT','Use moment storage plan [--enroll FILE] [--out FILE], migrate --file PLAN, or resume');
    const home=inspectHome();if(!home.registry)fail('NOT_FOUND','Select the existing initialized Moment home');
    let value;
    if(operation==='plan'){
      const enroll=options['--enroll']?await readJsonInput(options['--enroll']):[];
      if(!Array.isArray(enroll))fail('INVALID_ARGUMENT','Enrollment input must be an array of actual native session identities');
      value=planStorage(home.root,{enroll});if(options['--out'])publishPrivate(resolve(options['--out']),canonical(value)+'\n');
    }else{
      if(operation==='migrate' && !options['--file'])fail('INVALID_ARGUMENT','Migration requires an exact reviewed plan through --file');
      const plan=operation==='resume'?readPrivateJson(migrationJournal(home.root),262144).plan:await readJsonInput(options['--file']);
      value=await migrateStorage(home.root,plan);
    }
    console.log(JSON.stringify({ok:true,value}));return true;
  }catch(error){
    console.log(JSON.stringify({ok:false,error:{code:error.code??'INTERNAL',message:error.message,retry:error.retry??'never',details:null}}));process.exitCode=1;return true;
  }
}
