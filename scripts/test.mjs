import {mkdtempSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {openHome} from '../runtime/home.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),scratch=mkdtempSync(join(tmpdir(),'moment-tests-')),suiteHome=join(scratch,'home');
mkdirSync(suiteHome,{mode:0o700});
// Keep the suite's primary alias valid while individual fixture stores come and
// go. Tests and subprocesses must never establish an alias in the owner's home.
openHome({home:suiteHome,override:join(scratch,'primary')});
const env=Object.fromEntries(Object.entries({PATH:process.env.PATH,HOME:suiteHome,CODEX_HOME:join(scratch,'codex'),USER:process.env.USER,LOGNAME:process.env.LOGNAME,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG,LC_ALL:process.env.LC_ALL}).filter(([,v])=>v!==undefined));
const selected=process.argv.slice(2),files=selected.length?selected:readdirSync(join(root,'test')).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>join('test',f));
const child=spawn(process.execPath,['--test',...files],{cwd:root,env,stdio:'inherit'});
let interrupted=false;
const forward=signal=>{interrupted=true;child.kill(signal);};
const int=()=>forward('SIGINT'),term=()=>forward('SIGTERM');process.once('SIGINT',int);process.once('SIGTERM',term);
try {
 const {code,signal}=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
 if(interrupted||signal){console.error('Interrupted test run; owned recovery retained at '+scratch);process.exitCode=code||1;}
 else {rmSync(scratch,{recursive:true,force:true});process.exitCode=code??1;}
}catch(error){console.error('Test runner failed; owned recovery retained at '+scratch);throw error;}
finally{process.removeListener('SIGINT',int);process.removeListener('SIGTERM',term);}
