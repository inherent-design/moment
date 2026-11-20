import * as core from './semantic-core.mjs';

/** Event-driven coordinator. A provider is trusted installed code, never model-selected code. */
export class MemoryWorker {
  constructor(memory,{provider,onChange=()=>{},recover=false}={}) {
    this.memory=memory;this.provider=provider;this.onChange=onChange;this.closed=false;this.busy=false;
    const active=memory.active(),initial=core.memoryWorkerBootstrap(!!provider,!!provider?.unavailableReason,active,recover);
    if(initial.markUnknown)memory.unknown(active.id,'Previous service dispatch has no live owned provider handle after restart; reconcile before new inference');
    const mode=core.memoryWorkerMode(!!provider,!!provider?.unavailableReason,!!memory.active());
    this.state={state:mode,reason:{ready:'Configured checker awaits eligible input',disabled:'No checker provider is configured',unavailable:provider?.unavailableReason,unknown:'A retained dispatch needs reconciliation before new inference'}[mode]};
  }
  status() {return {...this.state};}
  wake() {
    if(!core.memoryWorkerEnabled(this.closed,!!this.provider,!!this.provider?.unavailableReason))return;
    const active=!!this.memory.active(),pending=core.memoryWorkerQueueNeeded(this.state.state,active)?this.memory.hasPending():false,plan=core.memoryWorkerWake(this.state.state,active,pending,this.busy,!!this.scheduled);
    if(plan.queued)this.state={state:'ready',reason:'Checker input is queued for dispatch'};
    if(plan.action==='MemoryWakeBusy'){this.wakeRequested=true;return;}
    if(plan.action==='MemoryWakeScheduled')return;
    this.scheduled=setImmediate(()=>{this.scheduled=undefined;this.running=this.run();});
  }
  async run() {
    if(this.closed || this.busy) return;
    this.busy=true;let continueQueue=false,dispatch;
    try {
      await this.provider.recoverIdle?.(this.memory);
      const active=this.memory.active(),demand=core.memoryWorkerDemand(!!active,active?false:this.memory.hasPending());
      if(demand==='MemoryWorkerRecover') {
        const recovery=await this.provider.recover?.(this.memory.recoveryDispatch?.(active)??active);
        if(this.closed) return;
        if(recovery) {
          const receipt=this.memory.reconcile(active.id,recovery);
          const action=core.memoryReconcile(active,active.id,recovery.kind);
          if(action==='MemoryReconcileOutput' || action==='MemoryReconcileFailure') await this.provider.settled?.(receipt);
          else if(action==='MemoryReconcileRetry') await this.provider.notStarted?.(active.id);
          else if(action==='MemoryReconcileCancelled') await this.provider.cancelled?.(active);
          continueQueue=true;return;
        }
        this.state={state:'unknown',reason:active.detail??'A retained dispatch needs reconciliation before new inference'};return;
      }
      if(demand==='MemoryWorkerIdle') {this.state={state:'ready',reason:'No eligible input is pending'};return;}
      // Provider qualification and supported authentication precede dispatch.
      this.state={state:'ready',reason:'Preparing the configured checker for admitted input'};
      const identity=await this.provider.ready();
      if(this.closed) return;
      dispatch=this.memory.claim(identity);
      if(!dispatch) {this.state={state:'ready',reason:'No eligible input is pending',model:identity.model};return;}
      if(dispatch.kind==='refused') {this.state={state:'ready',reason:dispatch.error.message,model:identity.model};continueQueue=true;return;}
      if(this.provider.prepare){
        try{
          const preparation=await this.provider.prepare(dispatch);
          this.memory.prepareProfile(dispatch.id,preparation);dispatch.nativePreparation=preparation;
        }catch(error){error.notStarted=true;throw error;}
      }
      this.controller=new AbortController();this.state={state:'running',reason:'One checker input is in progress',model:identity.model};
      const result=await this.provider.invoke(dispatch,this.controller.signal);
      if(this.closed) return;
      const receipt=result.failure?this.memory.failObserved(dispatch.id,result.failure,result.usage??{},result.rawOutput):this.memory.finish(dispatch.id,result.output===undefined?null:result.output,result.usage??{},{...(result.rawOutput===undefined?{}:{rawOutput:result.rawOutput})});
      await this.provider.settled?.(receipt);
      this.state={state:'ready',reason:'Checker result was observed and validated',model:identity.model};continueQueue=true;
    } catch(error) {
      if(this.closed) return;
      const diagnostic=typeof error.codexDiagnostic==='string'?error.codexDiagnostic:undefined;
      const fault=core.memoryWorkerFault(dispatch?.kind==='dispatch',core.memoryDispatch(this.memory.active(),dispatch?.id??''),!!error.notStarted);
      if(fault!=='MemoryWorkerUnavailable') {
        if(fault==='MemoryWorkerUnknown'||fault==='MemoryWorkerNotStarted') {
          this.memory.unknown(dispatch.id,diagnostic??'Checker completion could not be established; inspect the retained dispatch and provider receipt');
          if(fault==='MemoryWorkerNotStarted') {
            this.memory.reconcile(dispatch.id,{kind:'not_started',evidence:'The qualified provider observed that no inference turn was sent, or its request was rejected before admission.'});
            try{await this.provider.notStarted?.(dispatch.id);this.state={state:'unavailable',reason:diagnostic??'Native checker did not start; pending input is retained without automatic retry'};}
            catch{this.state={state:'unavailable',reason:'Checker did not start; retained provider cleanup needs inspection'};}
          } else {this.state={state:'unknown',reason:'Checker completion could not be established; checking retained provider evidence'};continueQueue=true;}
        } else this.state={state:'unavailable',reason:'Checker result is already settled; provider cleanup needs inspection'};
      } else this.state={state:'unavailable',reason:diagnostic??'Configured checker is unavailable; pending input is retained'};
    } finally {
      if(!dispatch && !this.closed)try{await this.provider?.idle?.();}catch{this.state={state:'unavailable',reason:'Idle checker cleanup needs inspection; retained cache remains readable'};continueQueue=false;}
      this.busy=false;this.controller=undefined;this.onChange();
      const wakeAgain=core.memoryWorkerAgain(continueQueue,this.wakeRequested,this.state.state,this.reconciledWhileBusy,this.closed);
      this.wakeRequested=false;this.reconciledWhileBusy=false;
      if(wakeAgain) this.wake();
    }
  }
  cancel(session,sequence) {
    const active=this.memory.active(),result=this.memory.cancel(session,sequence);
    if(core.memoryWorkerCancel(active,session,sequence,result.status)) this.controller?.abort();
    return result;
  }
  reconcile(id,resolution) {
    const value=this.memory.reconcile(id,resolution);
    if(this.busy)this.reconciledWhileBusy=true;
    const mode=core.memoryWorkerMode(!!this.provider,!!this.provider?.unavailableReason,false);
    this.state={state:mode,reason:{unavailable:this.provider?.unavailableReason,ready:this.busy?'Reconciliation is recorded; prior provider settlement is pending':'Reconciliation is recorded; the checker can resume',disabled:'No checker provider is configured'}[mode]};
    this.wake();return value;
  }
  async close() {
    if(this.closed) return;this.closed=true;clearImmediate(this.scheduled);this.controller?.abort();
    const active=this.memory.active();
    if(core.memoryDispatch(active,active?.id??'',true)) this.memory.unknown(active.id,'Service closed after possible dispatch; reconcile retained provider evidence');
    await this.provider?.close?.();
    if(this.running) {
      let timer;try {await Promise.race([this.running,new Promise(resolve=>{timer=setTimeout(resolve,2000);})]);}
      finally {clearTimeout(timer);}
    }
  }
}
