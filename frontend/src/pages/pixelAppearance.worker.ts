/// <reference lib="webworker" />
import {analyzePixelBatch,type PixelCrop} from './pixelAppearance';
const scope=self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage=(event:MessageEvent<{crops:PixelCrop[];selected:string}>)=>{
  try{
    const result=analyzePixelBatch(event.data.crops,event.data.selected);
    const transfers=result.flatMap(r=>r.rgba&&r.edges?[r.rgba.buffer,r.edges.buffer]:[]) as ArrayBuffer[];
    scope.postMessage({result},transfers);
  }catch(error){scope.postMessage({error:String(error)});}
};
