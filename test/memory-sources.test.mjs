import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {readCodexExchange,readCodexHistory} from '../runtime/memory-sources.mjs';import {bytesDigest} from '../runtime/json.mjs';
function fixture(t,{id='session-one',version='0.169.0',lines=[],suffix=''}={}) {
  const codexHome=mkdtempSync(join(tmpdir(),'mms-')),directory=join(codexHome,'sessions');mkdirSync(directory,{mode:0o700});
  const path=join(directory,'selected.jsonl'),header={type:'session_meta',payload:{id,session_id:id,cli_version:version}};
  writeFileSync(path,[header,...lines].map(line=>JSON.stringify(line)+'\n').join('')+suffix,{mode:0o600});t.after(()=>rmSync(codexHome,{recursive:true,force:true}));
  return {codexHome,path,read:(options={})=>readCodexExchange({codexHome,transcriptPath:path,sessionId:id,...options})};
}
const message=(text,extra={})=>({type:'response_item',timestamp:'2026-11-14T00:00:00.000Z',ordinal:12,payload:{type:'message',id:'assistant-wire-id',role:'assistant',phase:'final',content:[{type:'output_text',text}]},metadata:{retained_source:{id:{message_id:'visible-message-id',turn_id:'turn-one',role:'assistant'}},client_authored:false},...extra});
test('selected visible exchange preserves exact text, separate parts and raw selection identity',t=>{
  const text='Maybe use this.\nKeep the “maybe”. 🦉',frame=message(text),f=fixture(t,{lines:[frame]});
  const result=f.read();assert.equal(result.coverage.kind,'bounded-tail');assert.equal(result.exchange[0].text,text);assert.equal(result.exchange[0].authorship,'assistant');assert.equal(result.exchange[0].nativeItemId,'visible-message-id');
  const selection=result.exchange[0].selection,bytes=readFileSync(f.path).subarray(selection.offset,selection.offset+selection.byteLength);
  assert.equal(bytesDigest(bytes),selection.digest);assert.equal(JSON.parse(bytes).payload.content[selection.contentIndex].text,text);assert.equal(selection.clientAuthored,false);assert.equal(selection.ordinal,12);
});
test('qualified historical creation headers preserve source version and exact appended message bytes',t=>{
  const frame=message('A current visible reply in a conversation created by an older runtime.'),f=fixture(t,{version:'0.167.0',lines:[frame]});
  const result=f.read();assert.equal(result.coverage.kind,'bounded-tail');assert.equal(result.exchange[0].selection.headerVersion,'0.167.0');assert.equal(result.exchange[0].text,frame.payload.content[0].text);
  const selection=result.exchange[0].selection;assert.equal(bytesDigest(readFileSync(f.path).subarray(selection.offset,selection.offset+selection.byteLength)),selection.digest);
  for(const version of ['0.166.0','0.170.0','9.0.0']){const other=fixture(t,{version,lines:[frame]});assert.equal(other.read().exchange[0].selection.headerVersion,version);}
});
test('reasoning, tool output and user/harness content never become an assistant exchange',t=>{
  const f=fixture(t,{lines:[message('Visible response.'),{type:'response_item',payload:{type:'reasoning',summary:[{text:'Unrelated hidden material.'}]}},message('Not visible.',{payload:{type:'message',role:'assistant',phase:'analysis',content:[{type:'output_text',text:'Not visible.'}]}}),{type:'response_item',payload:{type:'custom_tool_call_output',output:'Tool bytes.'}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'A harness reminder.'}]},metadata:{client_authored:false,provenance:{type:'harness'}}}]});
  assert.equal(f.read().exchange[0].text,'Visible response.');
});
test('source identity, supported format and authorized roots are checked before text capture',t=>{
  const f=fixture(t,{lines:[message('Selected.')]}),other=fixture(t,{id:'session-two',lines:[message('Another conversation.')]}),unsupported=fixture(t,{version:'0.169.0',lines:[message('Unknown shape.',{payload:{type:'message',role:'assistant',content:'changed representation'}})]});
  assert.equal(f.read({sessionId:'session-two'}).coverage.code,'SESSION_IDENTITY_MISMATCH');assert.equal(f.read({transcriptPath:other.path}).coverage.code,'OUTSIDE_SOURCE_ROOT');assert.equal(unsupported.read().coverage.code,'UNSUPPORTED_MESSAGE_SHAPE');
  const alias=join(f.codexHome,'sessions/escape.jsonl');symlinkSync(other.path,alias);assert.equal(f.read({transcriptPath:alias}).coverage.code,'OUTSIDE_SOURCE_ROOT');
});
test('bounded tails skip partial initial lines, disclose incomplete final lines and preserve oversize gaps',t=>{
  const f=fixture(t,{lines:[{type:'response_item',payload:{type:'reasoning',encrypted_content:'x'.repeat(3000)}},message('Last complete visible response.')],suffix:'{"type":"partial'});
  const result=f.read({maximumBytes:1024});assert.equal(result.exchange[0].text,'Last complete visible response.');assert.equal(result.coverage.incompleteFinalLine,true);assert.ok(result.coverage.selectedBytes<=1024);
  assert.equal(f.read({maximumTextBytes:3}).coverage.code,'EXCHANGE_TEXT_BOUND');
  const gap=fixture(t,{lines:[message('Outside the selected window.'),{type:'response_item',payload:{type:'reasoning',encrypted_content:'x'.repeat(3000)}}]});assert.equal(gap.read({maximumBytes:1024}).coverage.code,'VISIBLE_EXCHANGE_OUTSIDE_WINDOW');
});
test('missing, malformed and unselected source inputs remain explicit unknowns without manufactured context',t=>{
  const f=fixture(t,{suffix:'not-json\n'});assert.equal(f.read().coverage.code,'MALFORMED_SOURCE');assert.deepEqual(readCodexExchange(),{exchange:[],coverage:{kind:'not-requested'}});assert.equal(f.read({transcriptPath:'relative'}).coverage.code,'INVALID_SELECTION');
});

const submission=(text,metadata={},extra={})=>({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text}],...extra},metadata});
test('history selection preserves ambiguous reply and actual exchange, excluding known harness notices without claiming human authorship',t=>{
  const f=fixture(t,{lines:[message('Maybe retain sources; do not install.'),submission('Yes, that.',{client_authored:true}),submission('Resume the goal.',{client_authored:false,provenance:{type:'harness'}}),submission('Control notice.',{},{internal_chat_message_metadata_passthrough:{content_item_metadata:[{provenance:{type:'harness'}}]}}),submission('Another thought.')]});
  const selected=readCodexHistory({runtimeId:'owned-native',codexHome:f.codexHome,selections:[{transcriptPath:f.path,sessionId:'session-one'}]});
  assert.equal(selected.captures.length,2);assert.equal(selected.coverage.excludedHarnessParts,2);assert.equal(selected.captures[0].message.authorship,'unknown');assert.equal(selected.captures[0].message.text,'Yes, that.');assert.equal(selected.captures[0].exchange[0].text,'Maybe retain sources; do not install.');
  const source=selected.captures[0].message.selection,raw=readFileSync(source.path).subarray(source.offset,source.offset+source.byteLength);assert.equal(bytesDigest(raw),source.digest);assert.equal(JSON.parse(raw).payload.content[source.contentIndex].text,'Yes, that.');
});
test('history bounds disclose omitted candidates, oversize parts, missing exchange and unavailable selected files',t=>{
  const f=fixture(t,{lines:[submission('First.'),submission('Second.'),submission('x'.repeat(80))]});
  const selected=readCodexHistory({runtimeId:'native',codexHome:f.codexHome,selections:[{transcriptPath:f.path,sessionId:'session-one'},{transcriptPath:join(f.codexHome,'absent'),sessionId:'session-two'}],maximumBytes:2048,maximumCaptures:1,maximumTextBytes:32});
  assert.equal(selected.captures.length,1);assert.equal(selected.captures[0].message.text,'Second.');assert.equal(selected.coverage.omittedCaptures,1);assert.equal(selected.coverage.oversizeParts,1);assert.equal(selected.coverage.missingExchange,2);assert.equal(selected.coverage.files[1].code,'SOURCE_UNAVAILABLE');
  assert.throws(()=>readCodexHistory({runtimeId:'native',codexHome:f.codexHome,selections:[]}),{code:'INVALID_ARGUMENT'});
});

test('native client_authored=false is not harness proof; explicit part provenance separates user text and control input',t=>{
  const metadata=(kind,type)=>({internal_chat_message_metadata_passthrough:{content_item_kinds:[kind],content_item_metadata:[{provenance:{type}}]}});
  const f=fixture(t,{lines:[submission('A UI-submitted preference.',{client_authored:false},metadata('user.text','user')),submission('Generated goal notice.',{client_authored:false},metadata('goal.internal_context','harness')),submission('<codex_internal_context source="goal">Quoted text.</codex_internal_context>',{client_authored:false},metadata('user.text','user'))]});
  const selected=readCodexHistory({runtimeId:'native',codexHome:f.codexHome,selections:[{transcriptPath:f.path,sessionId:'session-one'}]});
  assert.equal(selected.captures.length,2);assert.equal(selected.coverage.excludedHarnessParts,1);
  assert.equal(selected.captures[0].message.authorship,'unknown');assert.equal(selected.captures[0].message.selection.clientAuthored,false);
  assert.equal(selected.captures[0].message.selection.provenanceType,'user');assert.equal(selected.captures[0].message.selection.contentKind,'user.text');
  assert.equal(selected.captures[1].message.text,'<codex_internal_context source="goal">Quoted text.</codex_internal_context>');
});
