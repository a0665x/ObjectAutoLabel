import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createFlowWorker} from './opticalFlowWorker';
import type {FlowInput} from './opticalFlowCore';
class WorkerMock {
  static latest:WorkerMock;onmessage:((e:MessageEvent)=>void)|null=null;onerror:(()=>void)|null=null;
  postMessage=vi.fn();terminate=vi.fn();constructor(){WorkerMock.latest=this;}
}
const input=():FlowInput=>({gray:new Float32Array(32*32),w:32,h:32,points:[],reset:true,radius:5,threshold:3});
beforeEach(()=>{vi.stubGlobal('Worker',WorkerMock);});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('transfers grayscale pixels and permits only one analysis in flight',async()=>{
  const worker=createFlowWorker(),payload=input(),job=worker.analyze(payload);
  expect(WorkerMock.latest.postMessage).toHaveBeenCalledWith(payload,[payload.gray.buffer]);
  await expect(worker.analyze(input())).rejects.toThrow('already in progress');
  WorkerMock.latest.onmessage?.({data:{result:[]}} as MessageEvent);
  await expect(job).resolves.toEqual([]);worker.dispose();
  expect(WorkerMock.latest.terminate).toHaveBeenCalledOnce();
});
it('rejects pending work on disposal and does not retain a timeout',async()=>{
  vi.useFakeTimers();const worker=createFlowWorker(),job=worker.analyze(input());
  const stopped=expect(job).rejects.toThrow('stopped');worker.dispose();await stopped;
  expect(vi.getTimerCount()).toBe(0);await expect(worker.analyze(input())).rejects.toThrow('disposed');
});
it('terminates a stuck worker and reports an isolated optical-flow timeout',async()=>{
  vi.useFakeTimers();const worker=createFlowWorker(),job=worker.analyze(input());
  const stopped=expect(job).rejects.toThrow('timed out');vi.advanceTimersByTime(8000);await stopped;
  expect(WorkerMock.latest.terminate).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
