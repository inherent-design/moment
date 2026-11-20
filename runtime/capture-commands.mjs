import {join,resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {argumentsFor} from './commands.mjs';
import {inspectHome} from './home.mjs';
import {createService} from './service.mjs';
import {createClient} from './client.mjs';
import {createManaged} from './managed.mjs';
import {readJsonInput} from './input.mjs';
import {readPrivateJson,publishPrivate} from './private-files.mjs';
import {canonical,DomainError,fail} from './json.mjs';
import {publishCapture} from './captures.mjs';
import {planCaptureMaintenance,applyCaptureMaintenance} from './capture-maintenance.mjs';

const help='moment captures read --context ID --incident ID [--payloads JSON] [--maximum-bytes N] [--json]\nmoment captures record --file PUBLICATION [--json]\nmoment captures plan --file REQUEST [--out PLAN] [--json]\nmoment captures apply|reconcile --file PLAN [--json]\nOwner-local maintenance preserves exact paths/bytes only; requires enabled scoped policy and coordinated custody. No generic orphan prune.';
export async function runCaptureCommand(args){
  try{
    if(!args.length||args[0]==='--help'){console.log(help);return true;}
    const [operation,...rest]=args,{options,positionals}=argumentsFor(rest,['--file','--out','--context','--incident','--payloads','--maximum-bytes'],['--json']);
    const allowed={read:['--context','--incident','--payloads','--maximum-bytes','--json'],record:['--file','--json'],plan:['--file','--out','--json'],apply:['--file','--json'],reconcile:['--file','--json']};
    if(positionals.length||!allowed[operation]||Object.keys(options).some(k=>!allowed[operation].includes(k)))fail('INVALID_ARGUMENT',help);
    const home=inspectHome();if(!home.registry)fail('NOT_FOUND','Select the initialized existing Moment home');
    if(operation==='read'){
      if(!options['--context']||!options['--incident'])fail('INVALID_ARGUMENT','Select --context and --incident');
      const result=await createManaged({root:home.root}).call('captures.read',{target:{systemId:home.registry.systemId,contextId:options['--context'],incidentId:options['--incident']},...(options['--payloads']?{payloadIds:JSON.parse(options['--payloads'])}:{}),...(options['--maximum-bytes']?{maximumBytes:Number(options['--maximum-bytes'])}:{})});
      console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;return true;
    }
    if(!options['--file'])fail('INVALID_ARGUMENT','Select the exact reviewed JSON input through --file');
    const ready=await createService({root:home.root}).ensure();if(!ready.ok)throw Object.assign(new DomainError(ready.error.code,ready.error.message,ready.error.retry),{details:ready.error.details});
    const client=createClient(home.root),domain=async(method,input)=>{const r=await client.call(method,input);if(!r.ok)throw Object.assign(new DomainError(r.error.code,r.error.message,r.error.retry),{details:r.error.details});return r.value;};
    const description=await domain('system.describe',{protocolVersion:'0.1'}),owner=readPrivateJson(join(home.root,'runtime/owner.json'));
    if(description.principalId!==owner.principalId)fail('FORBIDDEN','Capture publication/maintenance requires the selected local operator; no owner fallback');
    const input=await readJsonInput(options['--file']),target=operation==='record'?input.manifest?.target:input.target;
    if(target?.systemId!==home.registry.systemId)fail('IDENTITY_CONFLICT','Capture input belongs to another Moment system');
    let value;
    if(operation==='record')value=await publishCapture(home.root,input,domain);
    else if(operation==='plan'){
      value=await planCaptureMaintenance(home.root,input,domain);
      if(options['--out']){const path=resolve(options['--out']);if(existsSync(path)){if(canonical(readPrivateJson(path,524288))!==canonical(value))fail('IDEMPOTENCY_CONFLICT','Output plan already names different observations');}else publishPrivate(path,canonical(value)+'\n');}
    }else value=await applyCaptureMaintenance(home.root,input,domain,{reconcile:operation==='reconcile'});
    console.log(JSON.stringify({ok:true,value}));return true;
  }catch(error){console.log(JSON.stringify({ok:false,error:{code:error.code??'INVALID_ARGUMENT',message:error.message,retry:error.retry??'never',details:error.details??null}}));process.exitCode=1;return true;}
}
