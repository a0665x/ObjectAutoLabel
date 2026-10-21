/// <reference lib="webworker" />
import {searchColorSample,type ColorSearchInput} from './colorSampleTracking';
const scope=self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage=(event:MessageEvent<ColorSearchInput>)=>{try{scope.postMessage({result:searchColorSample(event.data)});}catch(error){scope.postMessage({error:String(error)});}};
