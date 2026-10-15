import {createFlowCore,type FlowInput} from './opticalFlowCore';
const core=createFlowCore();
self.onmessage=(event:MessageEvent<FlowInput>)=>{
  try {self.postMessage({result:core.analyze(event.data)});}
  catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
