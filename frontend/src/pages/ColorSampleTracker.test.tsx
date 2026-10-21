// @vitest-environment jsdom
import {act,cleanup,render} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ColorSampleTracker} from './ColorSampleTracker';
import {analyzePixels} from './pixelAppearance';
import type {ColorSeed} from './colorSampleTracking';
class FakeWorker {static latest:FakeWorker;onmessage:((e:MessageEvent)=>void)|null=null;onerror:(()=>void)|null=null;postMessage=vi.fn();terminate=vi.fn();constructor(){FakeWorker.latest=this;}}
beforeEach(()=>{
  vi.stubGlobal('Worker',FakeWorker);vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage:vi.fn(),getImageData:()=>({data:new Uint8ClampedArray(100*60*4)})} as unknown as CanvasRenderingContext2D);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function props(){const video=document.createElement('video');Object.defineProperties(video,{readyState:{value:2},videoWidth:{value:100},videoHeight:{value:60}});const seed:ColorSeed={token:'sample:1',classId:0,name:'person',box:[.1,.1,.3,.4],features:analyzePixels(new Uint8ClampedArray(8*8*4),8,8),time:0,width:8,height:8};return {video:{current:video},frames:{current:[]},seed,active:true,sessionKey:1,onEstimate:vi.fn()};}
it('keeps a visible dashed box while searching without any detection metadata',()=>{
  const p=props(),view=render(<ColorSampleTracker {...p}/>);
  expect(view.container.querySelector('[data-color-sample-mode="hold"]')).toBeTruthy();
  const input=FakeWorker.latest.postMessage.mock.calls[0][0];expect(input.candidates).toEqual([]);expect(input.width).toBeLessThanOrEqual(240);
});
it('renders a searched estimate without inventing a ByteTrack ID, then terminates on disable',async()=>{
  const p=props(),view=render(<ColorSampleTracker {...p}/>);
  await act(async()=>FakeWorker.latest.onmessage?.({data:{result:{box:[.5,.1,.7,.4],mode:'search',similarity:.9,reason:'matched',id:null,time:0}}} as MessageEvent));
  expect(view.container.querySelector('[data-color-sample-mode="search"]')).toBeTruthy();expect(view.container.textContent).toContain('not detector');
  view.rerender(<ColorSampleTracker {...p} active={false}/>);expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();expect(view.container.querySelector('svg')).toBeNull();
});
it('does no worker/canvas work without an enabled selected sample',()=>{
  const p=props();const view=render(<ColorSampleTracker {...p} active={false}/>);
  expect(view.container.querySelector('svg')).toBeNull();expect(HTMLCanvasElement.prototype.getContext).not.toHaveBeenCalled();
});
