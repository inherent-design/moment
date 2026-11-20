import {existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {privateNativeJson} from './codex-memory.mjs';
import {replacePrivate} from './private-files.mjs';
import {canonical,fail} from './json.mjs';

/** One local daemon owns this durable slot. Native uncertainty survives daemon restart. */
export class NativeLabor {
  constructor(root,{onChange=()=>{}}={}) {
    mkdirSync(join(root,'runtime'),{recursive:true,mode:0o700});this.path=join(root,'runtime/native-labor.json');this.onChange=onChange;this.waiters=[];
    if(existsSync(this.path)) {
      const value=privateNativeJson(this.path,8192);
      if(value.formatVersion!==1 || Object.keys(value).some(k=>!['formatVersion','holder'].includes(k)) || value.holder && (!['memory','guidance'].includes(value.holder.component) || typeof value.holder.dispatchId!=='string' || typeof value.holder.inputDigest!=='string'))fail('IDENTITY_CONFLICT','Retained native labor slot needs inspection');
      this.holder=value.holder;
    }
  }
  save(){replacePrivate(this.path,JSON.stringify({formatVersion:1,...(this.holder?{holder:this.holder}:{})})+'\n');}
  retain(component,dispatch) {
    const next={component,dispatchId:dispatch.id,inputDigest:dispatch.inputDigest};
    if(this.holder && canonical(this.holder)!==canonical(next))fail('IDENTITY_CONFLICT','Conflicting native labor reservations require reconciliation');
    this.holder=next;this.save();
  }
  acquire(component) {
    if(this.closed)return Promise.reject(Error('Native labor coordinator is closed'));
    return new Promise((resolve,reject)=>{this.waiters.push({component,resolve,reject});this.drain();});
  }
  drain() {
    if(this.closed || this.holder || this.preparing || !this.waiters.length)return;
    const next=this.waiters.shift();this.preparing=next.component;next.resolve();
  }
  release(component,id) {
    if(this.holder) {
      if(this.holder.component!==component || this.holder.dispatchId!==id)fail('IDENTITY_CONFLICT','Native labor settlement names another dispatch');
      this.holder=undefined;this.save();
    }
    if(this.preparing===component)this.preparing=undefined;this.drain();this.onChange();
  }
  provider(component,provider) {
    if(!provider || provider.unavailableReason)return provider;
    const slot=this;let prepared=false;
    return {
      async recoverIdle(memory) {
        if(component!=='memory' || slot.holder?.component!==component || memory.active())return;
        const id=slot.holder.dispatchId,settlement=memory.retainedSettlement(id);
        if(!settlement)fail('OUTCOME_UNKNOWN','Native memory slot has no attributable dispatch or settlement; preserve its recovery evidence','reconcile');
        if(settlement.kind==='receipt')await provider.settled?.(settlement.receipt);
        else if(settlement.kind==='not_started')await provider.notStarted?.(id);
        else await provider.cancelled?.(settlement.dispatch);
        prepared=false;slot.release(component,id);
      },
      async ready(){await slot.acquire(component);prepared=true;try{return await provider.ready();}catch(error){if(!slot.holder){prepared=false;slot.release(component);}throw error;}},
      ...(provider.prepare?{prepare(dispatch){if(!prepared)throw Object.assign(Error('Native labor was not prepared'),{notStarted:true});return provider.prepare(dispatch);}}:{}),
      async invoke(dispatch,signal){if(!prepared)throw Object.assign(Error('Native labor was not prepared'),{notStarted:true});slot.retain(component,dispatch);return provider.invoke(dispatch,signal);},
      recover(dispatch){slot.retain(component,dispatch);return provider.recover?.(dispatch);},
      async settled(receipt){await provider.settled?.(receipt);prepared=false;if(!slot.holder || slot.holder.component===component && slot.holder.dispatchId===receipt.dispatchId)slot.release(component,receipt.dispatchId);},
      async notStarted(id){await provider.notStarted?.(id);prepared=false;slot.release(component,id);},
      async cancelled(dispatch){await provider.cancelled?.(dispatch);prepared=false;slot.release(component,dispatch.id);},
      async idle(){await provider.idle?.();if(prepared && !slot.holder){prepared=false;slot.release(component);}},
      async close(){await provider.close?.();if(prepared && !slot.holder){prepared=false;slot.release(component);}},
    };
  }
  close(){this.closed=true;for(const waiter of this.waiters.splice(0))waiter.reject(Error('Native labor coordinator closed before dispatch'));}
}
