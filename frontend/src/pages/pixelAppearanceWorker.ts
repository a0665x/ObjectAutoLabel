import type {PixelCrop,PixelResult} from './pixelAppearance';
export function createPixelWorker() {
  const worker=new Worker(new URL('./pixelAppearance.worker.ts',import.meta.url),{type:'module'});
  let closed=false,pending:{resolve:(value:PixelResult[])=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
  function dispose(){closed=true;if(pending){clearTimeout(pending.timer);pending.reject(new Error('Pixel analysis stopped'));pending=undefined;}worker.terminate();}
  worker.onmessage=(event:MessageEvent<{result?:PixelResult[];error?:string}>)=>{
    const job=pending;if(!job)return;pending=undefined;clearTimeout(job.timer);
    if(event.data.error)job.reject(new Error(event.data.error));else job.resolve(event.data.result??[]);
  };
  worker.onerror=dispose;
  return {dispose,analyze(crops:PixelCrop[],selected:string):Promise<PixelResult[]>{
    if(closed||pending)return Promise.reject(new Error('Pixel worker unavailable or busy'));
    return new Promise((resolve,reject)=>{
      pending={resolve,reject,timer:setTimeout(dispose,8000)};
      try{worker.postMessage({crops,selected},crops.map(c=>c.rgba.buffer));}catch{dispose();}
    });
  }};
}
