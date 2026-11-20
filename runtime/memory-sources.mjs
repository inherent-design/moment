import {realpathSync,openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {join,sep,isAbsolute} from 'node:path';
import {parseJson} from './wire.mjs';
import {bytesDigest,fail} from './json.mjs';
import * as core from './semantic-core.mjs';

function selectedFrames({codexHome,transcriptPath,sessionId,maximumBytes}) {
  const unavailable=code=>({frames:[],coverage:{kind:'unavailable',code}});
  if(!transcriptPath)return {frames:[],coverage:{kind:'not-requested'}};
  if(!isAbsolute(transcriptPath) || !isAbsolute(codexHome??'') || typeof sessionId!=='string' || !Number.isInteger(maximumBytes) || maximumBytes<1024 || maximumBytes>8388608)return unavailable('INVALID_SELECTION');
  let fd;
  try {
    const roots=['sessions','archived_sessions'].flatMap(name=>{try{return [realpathSync(join(codexHome,name))];}catch{return [];}}),path=realpathSync(transcriptPath);
    if(!roots.some(root=>path.startsWith(root+sep)))return unavailable('OUTSIDE_SOURCE_ROOT');
    fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd);
    if(!stat.isFile() || stat.uid!==process.getuid())return unavailable('UNQUALIFIED_SOURCE');
    const headerBytes=Buffer.alloc(Math.min(stat.size,65536)),headerLength=readSync(fd,headerBytes,0,headerBytes.length,0),headerEnd=headerBytes.subarray(0,headerLength).indexOf(10);
    if(headerEnd<0)return unavailable('HEADER_BOUND');
    const header=parseJson(new TextDecoder('utf8',{fatal:true}).decode(headerBytes.subarray(0,headerEnd))),metadata=header.payload;
    if(header.type!=='session_meta' || !metadata || (metadata.session_id??metadata.id)!==sessionId || metadata.session_id && metadata.id && metadata.session_id!==metadata.id)return unavailable('SESSION_IDENTITY_MISMATCH');
    const headerVersion=typeof metadata.cli_version==='string' && metadata.cli_version.length>0 && Buffer.byteLength(metadata.cli_version)<=128?metadata.cli_version:'unknown';
    const start=Math.max(0,stat.size-maximumBytes),bytes=Buffer.alloc(stat.size-start),length=readSync(fd,bytes,0,bytes.length,start),snapshot=bytes.subarray(0,length);
    let offset=start,position=0;
    if(start>0){const first=snapshot.indexOf(10);if(first<0)return unavailable('TAIL_BOUND');position=first+1;offset+=position;}
    const frames=[];
    while(position<snapshot.length){
      const end=snapshot.indexOf(10,position);if(end<0)break;
      const line=snapshot.subarray(position,end);let frame;
      try{frame=parseJson(new TextDecoder('utf8',{fatal:true}).decode(line));}catch{return unavailable('MALFORMED_SOURCE');}
      if(frame.type==='response_item' && frame.payload?.type==='message') {
        const item=frame.payload;
        if(typeof item.role!=='string' || !Array.isArray(item.content) || item.content.some(part=>!part || typeof part!=='object' || typeof part.type!=='string' || ['input_text','output_text'].includes(part.type) && typeof part.text!=='string'))return unavailable('UNSUPPORTED_MESSAGE_SHAPE');
        frames.push({frame,item,path,headerVersion,offset,byteLength:line.length,digest:bytesDigest(line)});
      }
      offset+=end-position+1;position=end+1;
    }
    return {frames,coverage:{kind:'bounded-tail',sessionVerified:true,selectedBytes:length,sourceBytes:stat.size,incompleteFinalLine:position<snapshot.length}};
  }catch{return unavailable('SOURCE_UNAVAILABLE');}
  finally{if(fd!==undefined)closeSync(fd);}
}
const partsOf=(selected,type)=>(selected.item.content??[]).flatMap((part,index)=>part.type===type && typeof part.text==='string'?[{part,index}]:[]);
function partMetadata(selected,index) {
  const message=selected.item.internal_chat_message_metadata_passthrough;
  return {provenance:message?.content_item_metadata?.[index]?.provenance??selected.frame.metadata?.provenance,contentKind:message?.content_item_kinds?.[index],turnId:message?.turn_id};
}
function messageFrom(selected,{part,index},authorship) {
  const {frame,item}=selected,metadata=frame.metadata??{},retained=metadata.retained_source?.id,native=partMetadata(selected,index),turnId=retained?.turn_id??native.turnId;
  const bounded=value=>typeof value==='string'&&value.length&&Buffer.byteLength(value)<=128;
  return {text:part.text,authorship,...(typeof retained?.message_id==='string'?{nativeItemId:retained.message_id}:typeof item.id==='string'?{nativeItemId:item.id}:{}),...(typeof turnId==='string'?{turnId}:{}),selection:{kind:'codex-rollout',path:selected.path,offset:selected.offset,byteLength:selected.byteLength,digest:selected.digest,contentIndex:index,headerVersion:selected.headerVersion,...(typeof frame.timestamp==='string'?{nativeTimestamp:frame.timestamp}:{}),...(Number.isSafeInteger(frame.ordinal)&&frame.ordinal>=0?{ordinal:frame.ordinal}:{}),...(typeof metadata.client_authored==='boolean'?{clientAuthored:metadata.client_authored}:{}),...(bounded(native.provenance?.type)?{provenanceType:native.provenance.type}:{}),...(bounded(native.contentKind)?{contentKind:native.contentKind}:{})}};
}
const boundedParts=(parts,maximumTextBytes)=>core.memoryPartsFit(parts.map(({part})=>Buffer.byteLength(part.text)),maximumTextBytes);

/** Latest preceding visible text, with a verified source window; no reasoning/tool payloads. */
export function readCodexExchange({codexHome,transcriptPath,sessionId,maximumBytes=1048576,maximumTextBytes=65536}={}) {
  if(!Number.isInteger(maximumTextBytes) || maximumTextBytes<1 || maximumTextBytes>1048576)return {exchange:[],coverage:{kind:'unavailable',code:'INVALID_SELECTION'}};
  const selected=selectedFrames({codexHome,transcriptPath,sessionId,maximumBytes});
  if(selected.coverage.kind!=='bounded-tail')return {exchange:[],coverage:selected.coverage};
  const index=core.memoryLatestExchange(selected.frames.map(frame=>({...frame,outputParts:partsOf(frame,'output_text').length}))),last=index===undefined?undefined:selected.frames[index];
  if(!last)return {exchange:[],coverage:{kind:'unavailable',code:'VISIBLE_EXCHANGE_OUTSIDE_WINDOW'}};
  const parts=partsOf(last,'output_text');
  if(!boundedParts(parts,maximumTextBytes))return {exchange:[],coverage:{kind:'unavailable',code:'EXCHANGE_TEXT_BOUND'}};
  return {exchange:parts.map(part=>messageFrom(last,part,'assistant')),coverage:selected.coverage};
}

/** Explicit ordered file selection only. Preparing a rebuild performs no writes or inference. */
export function readCodexHistory({runtimeId,codexHome,selections,maximumBytes=1048576,maximumCaptures=64,maximumTextBytes=65536}={}) {
  if(typeof runtimeId!=='string' || !runtimeId.length || Buffer.byteLength(runtimeId)>256 || !Array.isArray(selections) || !selections.length || selections.length>8 || !Number.isInteger(maximumBytes) || maximumBytes<1024*selections.length || maximumBytes>8388608 || !Number.isInteger(maximumCaptures) || maximumCaptures<1 || maximumCaptures>64 || !Number.isInteger(maximumTextBytes) || maximumTextBytes<1 || maximumTextBytes>65536)fail('INVALID_ARGUMENT','Select one to eight session files, an aggregate 1 KiB–8 MiB window and at most sixty-four captures');
  const captures=[],files=[],seen=new Set();let omittedCaptures=0,excludedHarnessParts=0,oversizeParts=0,missingExchange=0;
  const perFile=Math.floor(maximumBytes/selections.length);
  for(const selection of selections){
    if(!selection || Object.keys(selection).some(key=>!['transcriptPath','sessionId'].includes(key)) || typeof selection.sessionId!=='string' || !selection.sessionId.length || selection.sessionId.length>256 || typeof selection.transcriptPath!=='string')fail('INVALID_ARGUMENT','History selections require an explicit transcript path and session identity');
    const identity=selection.transcriptPath+'\0'+selection.sessionId;if(seen.has(identity))fail('INVALID_ARGUMENT','Repeated history file selection');seen.add(identity);
    const selected=selectedFrames({codexHome,...selection,maximumBytes:perFile});files.push({...selection,...selected.coverage});let exchange=[];
    for(const frame of selected.frames){
      const action=core.memoryFrame(frame.item);
      if(action==='MemoryExchangeFrame'){
        const parts=partsOf(frame,'output_text');exchange=boundedParts(parts,maximumTextBytes)?parts.map(part=>messageFrom(frame,part,'assistant')):[];continue;
      }
      if(action!=='MemoryUserFrame')continue;
      for(const part of partsOf(frame,'input_text')){
        const provenance=partMetadata(frame,part.index).provenance;
        const choice=core.memoryHistoryPart(provenance?.type,Buffer.byteLength(part.part.text),maximumTextBytes);
        if(choice==='MemoryHarnessPart'){excludedHarnessParts=core.counterNext(excludedHarnessParts,'Excluded harness part count');continue;}
        if(choice==='MemoryOversizePart'){oversizeParts=core.counterNext(oversizeParts,'Oversize history part count');continue;}
        if(!exchange.length)missingExchange=core.counterNext(missingExchange,'Missing exchange count');
        captures.push({session:{runtimeId,sessionId:selection.sessionId},message:messageFrom(frame,part,'unknown'),...(exchange.length?{exchange}:{})});
        if(core.memoryHistoryFull(captures.length,maximumCaptures)){captures.shift();omittedCaptures=core.counterNext(omittedCaptures,'Omitted history capture count');}
      }
    }
  }
  return {captures,coverage:{kind:'selected-history',ordering:'supplied-files-then-source-order',files,omittedCaptures,excludedHarnessParts,oversizeParts,missingExchange}};
}
