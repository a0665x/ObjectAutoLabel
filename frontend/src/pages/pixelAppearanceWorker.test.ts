import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createPixelWorker} from './pixelAppearanceWorker';
import type {PixelCrop} from './pixelAppearance';
class FakeWorker {
  static latest:FakeWorker;onmessage:((event:MessageEvent)=>void)|null=null;onerror:(()=>void)|null=null;
  postMessage=vi.fn();terminate=vi.fn();constructor(){FakeWorker.latest=this;}
}
beforeEach(()=>vi.stubGlobal('Worker',FakeWorker));
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
const crop=():PixelCrop=>({key:'a',object:{id:'a',box:[0,0,8,8],score:1,name:'person',class_id:0},source:[0,0,8,8],width:8,height:8,rgba:new Uint8ClampedArray(256)});
it('transfers crop pixels, bounds in-flight work and releases the slot on response',async()=>{
  const worker=createPixelWorker(),input=crop(),pending=worker.analyze([input],'a');
  expect(FakeWorker.latest.postMessage).toHaveBeenCalledWith({crops:[input],selected:'a'},[input.rgba.buffer]);
  await expect(worker.analyze([crop()],'a')).rejects.toThrow('busy');
  FakeWorker.latest.onmessage?.({data:{result:[]}} as MessageEvent);await expect(pending).resolves.toEqual([]);worker.dispose();
});
it('terminates timed-out analysis and rejects pending work without retained timers',async()=>{
  vi.useFakeTimers();const worker=createPixelWorker(),pending=worker.analyze([crop()],'a');
  const stopped=expect(pending).rejects.toThrow('stopped');vi.advanceTimersByTime(8000);await stopped;
  expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
