import type {FlowInput,FlowResult} from './opticalFlowCore';

/** One job in flight, transferable grayscale pixels, no unbounded frame queue. */
export function createFlowWorker() {
  const worker=new Worker(new URL('./opticalFlow.worker.ts',import.meta.url),{type:'module'});
  let disposed=false;
  let pending:{resolve:(result:FlowResult[])=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
  function fail(message:string) {
    if(pending){clearTimeout(pending.timer);pending.reject(new Error(message));pending=undefined;}
    disposed=true;worker.terminate();
  }
  worker.onmessage=(event:MessageEvent<{result?:FlowResult[];error?:string}>)=>{
    const job=pending;if(!job)return;
    pending=undefined;clearTimeout(job.timer);
    if(event.data.error)job.reject(new Error(event.data.error));else job.resolve(event.data.result??[]);
  };
  worker.onerror=()=>fail('Optical-flow worker failed');
  return {
    analyze(input:FlowInput):Promise<FlowResult[]> {
      if(disposed)return Promise.reject(new Error('Optical-flow worker disposed'));
      if(pending)return Promise.reject(new Error('Optical-flow analysis already in progress'));
      return new Promise((resolve,reject)=>{
        pending={resolve,reject,timer:setTimeout(()=>fail('Optical-flow analysis timed out'),8000)};
        try{worker.postMessage(input,[input.gray.buffer]);}catch(error){fail(String(error));}
      });
    },
    dispose(){fail('Optical-flow analysis stopped');},
  };
}
