// @vitest-environment jsdom
import {act,cleanup,render,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {StreamOpticalFlowOverlay} from './StreamOpticalFlowOverlay';
import {defaultFlowSettings} from './opticalFlowModel';
import * as workers from './opticalFlowWorker';
import type {FlowInput,FlowResult} from './opticalFlowCore';
const draw=vi.hoisted(()=>vi.fn());
vi.mock('./opticalFlowDraw',()=>({drawOpticalFlow:draw}));
const context={drawImage:vi.fn(),getImageData:vi.fn(()=>({data:new Uint8ClampedArray(64*36*4)})),clearRect:vi.fn()};
beforeEach(()=>{vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);draw.mockClear();context.drawImage.mockClear();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function setup(){
  const video=document.createElement('video');Object.defineProperties(video,{readyState:{value:2},videoWidth:{value:64},videoHeight:{value:36}});
  video.currentTime=0;
  const callbacks:Array<VideoFrameRequestCallback>=[];
  video.requestVideoFrameCallback=vi.fn(callback=>{callbacks.push(callback);return callbacks.length;});
  video.cancelVideoFrameCallback=vi.fn();
  const analyze=vi.fn(async(input:FlowInput):Promise<FlowResult[]>=>input.points.map(p=>({...p,dx:1,dy:0,gx:1,gy:1,valid:input.reset?null:true,confidence:.8,error:0})));
  const dispose=vi.fn();vi.spyOn(workers,'createFlowWorker').mockReturnValue({analyze,dispose});
  return {props:{video:{current:video},settings:defaultFlowSettings,active:true,fps:15,sessionKey:1,resetKey:0,onSummary:vi.fn()},video,callbacks,analyze,dispose};
}
it('does no pixel reads or worker allocation while unchecked and disposes on disable',async()=>{
  const fixture=setup(),view=render(<StreamOpticalFlowOverlay {...fixture.props}/>);
  expect(workers.createFlowWorker).not.toHaveBeenCalled();expect(context.drawImage).not.toHaveBeenCalled();
  view.rerender(<StreamOpticalFlowOverlay {...fixture.props} settings={{...defaultFlowSettings,enabled:true}}/>);
  await waitFor(()=>expect(fixture.analyze).toHaveBeenCalledOnce());
  view.rerender(<StreamOpticalFlowOverlay {...fixture.props}/>);
  expect(fixture.dispose).toHaveBeenCalledOnce();expect(view.container.querySelector('canvas')).toBeNull();
});
it('uses new presented media frames, preserves paused history and resets on session changes',async()=>{
  const f=setup(),props={...f.props,settings:{...defaultFlowSettings,enabled:true}};
  const view=render(<StreamOpticalFlowOverlay {...props}/>);
  await waitFor(()=>expect(f.analyze).toHaveBeenCalledOnce());
  await act(async()=>f.callbacks.shift()?.(0,{mediaTime:0} as VideoFrameCallbackMetadata));
  expect(f.analyze).toHaveBeenCalledOnce();
  f.video.currentTime=1/15;
  await act(async()=>f.callbacks.shift()?.(0,{mediaTime:1/15} as VideoFrameCallbackMetadata));
  expect(f.analyze).toHaveBeenCalledTimes(2);expect(f.analyze.mock.calls[1][0].reset).toBe(false);
  await act(async()=>f.video.dispatchEvent(new Event('pause')));
  expect(f.analyze).toHaveBeenCalledTimes(2);
  view.rerender(<StreamOpticalFlowOverlay {...props} settings={{...props.settings,gain:5}}/>);
  expect(f.dispose).not.toHaveBeenCalled();expect(f.analyze).toHaveBeenCalledTimes(2);expect(draw).toHaveBeenCalled();
  view.rerender(<StreamOpticalFlowOverlay {...props} sessionKey={2}/>);
  expect(f.dispose).toHaveBeenCalledOnce();await waitFor(()=>expect(f.analyze).toHaveBeenCalledTimes(3));
  expect(f.analyze.mock.calls[2][0].reset).toBe(true);
});

it('coalesces busy frame callbacks instead of queuing every decoded frame',async()=>{
  const f=setup();let finish!:(result:Awaited<ReturnType<typeof f.analyze>>)=>void;
  f.analyze.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  render(<StreamOpticalFlowOverlay {...f.props} settings={{...defaultFlowSettings,enabled:true}}/>);
  const input=f.analyze.mock.calls[0][0];
  for(const time of [1/15,2/15]){f.video.currentTime=time;await act(async()=>f.callbacks.shift()?.(0,{mediaTime:time} as VideoFrameCallbackMetadata));}
  expect(f.analyze).toHaveBeenCalledOnce();
  await act(async()=>finish(input.points.map(p=>({...p,dx:0,dy:0,gx:0,gy:0,valid:null,confidence:0,error:null}))));
  expect(f.analyze).toHaveBeenCalledTimes(2);
});

it('cannot paint or publish an in-flight result after the checkbox is disabled',async()=>{
  const f=setup();let finish!:(result:Awaited<ReturnType<typeof f.analyze>>)=>void;
  f.analyze.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<StreamOpticalFlowOverlay {...f.props} settings={{...defaultFlowSettings,enabled:true}}/>);
  const input=f.analyze.mock.calls[0][0];
  view.rerender(<StreamOpticalFlowOverlay {...f.props}/>);
  await act(async()=>finish(input.points.map(p=>({...p,dx:0,dy:0,gx:0,gy:0,valid:null,confidence:0,error:null}))));
  expect(draw).not.toHaveBeenCalled();expect(f.props.onSummary).toHaveBeenLastCalledWith(undefined);
});

it('publishes the final measured statistics when pausing before the UI throttle expires',async()=>{
  const f=setup();Object.defineProperty(f.video,'paused',{value:false,writable:true});
  vi.spyOn(performance,'now').mockReturnValue(10);
  render(<StreamOpticalFlowOverlay {...f.props} settings={{...defaultFlowSettings,enabled:true}}/>);
  await waitFor(()=>expect(f.analyze).toHaveBeenCalledOnce());
  f.video.currentTime=1/15;
  await act(async()=>f.callbacks.shift()?.(0,{mediaTime:1/15} as VideoFrameCallbackMetadata));
  expect(f.props.onSummary.mock.calls.at(-1)?.[0].state).toBe('reference');
  Object.defineProperty(f.video,'paused',{value:true});
  await act(async()=>f.video.dispatchEvent(new Event('pause')));
  expect(f.props.onSummary.mock.calls.at(-1)?.[0]).toMatchObject({state:'measured',valid:144});
});
