// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SelectedPixelInspector} from './SelectedPixelInspector';
import {analyzePixels} from './pixelAppearance';
import * as workers from './pixelAppearanceWorker';
import type {TrackingFrame} from './StreamTrackingOverlay';
import type {BboxSnapshot,YoloEvidence} from './bboxSampleCache';
const red=Uint8ClampedArray.from(Array.from({length:64},()=>[255,0,0,255]).flat());
const blue=Uint8ClampedArray.from(Array.from({length:64},()=>[0,0,255,255]).flat());
const ctx={drawImage:vi.fn(),getImageData:vi.fn(()=>({data:blue.slice()})),createImageData:vi.fn((w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)})),putImageData:vi.fn()};
beforeEach(()=>{
  vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  ctx.putImageData.mockClear();ctx.drawImage.mockClear();ctx.getImageData.mockClear();
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
function setup(){
  const video=document.createElement('video');Object.defineProperties(video,{readyState:{value:2},videoWidth:{value:64},videoHeight:{value:36}});video.currentTime=0;
  const objects=[0,1].map(i=>({id:`0:${i+1}`,tracked:true,detection_index:i,box:[i*8,0,i*8+8,8],score:.9,class_id:0,name:'person'}));
  const raw:YoloEvidence[]=objects.map(object=>({...object,id:null,tracked:false,cache_id:`session:0:${object.detection_index}`,frame_index:0,media_time:12,image_width:64,image_height:36,width:8,height:8,crop_box:object.box,features:analyzePixels(red,8,8),origin:'yolo-pre-tracker'}));
  const frame:TrackingFrame={time:0,width:64,height:36,dt_ms:1000,objects,raw_detections:raw};
  const read=vi.fn(async(key:string,_pin?:boolean):Promise<BboxSnapshot>=>({...raw.find(item=>item.cache_id===key)!,rgba_base64:btoa(String.fromCharCode(...red))}));
  return {props:{video:{current:video},frames:{current:[frame]},selected:'0:1',active:true,sessionKey:1,readBboxSample:read},video,frame,raw,read};
}
it('does not read pixels or request crops without active tracking and selection',()=>{
  const f=setup(),view=render(<SelectedPixelInspector {...f.props} active={false}/>);
  view.rerender(<SelectedPixelInspector {...f.props} selected={null}/>);
  expect(f.read).not.toHaveBeenCalled();expect(ctx.drawImage).not.toHaveBeenCalled();
});
it('locks red inference pixels although playback is blue, and compares every raw box',async()=>{
  const f=setup(),worker=vi.spyOn(workers,'createPixelWorker');render(<SelectedPixelInspector {...f.props}/>);
  await screen.findByText(/^px1-/);
  expect(f.read).toHaveBeenCalledExactlyOnceWith('session:0:0',true);
  expect(ctx.drawImage).not.toHaveBeenCalled();expect(ctx.getImageData).not.toHaveBeenCalled();expect(worker).not.toHaveBeenCalled();
  expect(screen.getByText('2 / 2')).toBeTruthy();expect(screen.getByText('1 / 2')).toBeTruthy();
  expect(screen.getByText(/Locked · YOLO before tracking/)).toBeTruthy();
  expect(screen.getAllByRole('img',{name:/Selected: Red 100.0%/})).toHaveLength(1);
});
it('preserves the fixed reference over later frames and replaces it only on explicit resample',async()=>{
  const f=setup();render(<SelectedPixelInspector {...f.props}/>);const index=await screen.findByText(/^px1-/),initial=index.textContent;
  f.raw.forEach(raw=>{raw.features=analyzePixels(blue,8,8);raw.media_time=12.5;raw.frame_index=1;});
  f.read.mockImplementation(async key=>({...f.raw.find(item=>item.cache_id===key)!,rgba_base64:btoa(String.fromCharCode(...blue))}));
  f.video.currentTime=.5;await act(async()=>f.video.dispatchEvent(new Event('pause')));
  expect(index.textContent).toBe(initial);
  fireEvent.click(screen.getByRole('button',{name:'Resample'}));
  await waitFor(()=>expect(screen.getByText(/^px1-/).textContent).not.toBe(initial));
});
it('does not sample synthetic tracks but retains raw YOLO comparisons',async()=>{
  const f=setup();render(<SelectedPixelInspector {...f.props}/>);await screen.findByText(/^px1-/);
  f.frame.objects[0].predicted=true;f.video.currentTime=.5;
  await act(async()=>f.video.dispatchEvent(new Event('pause')));
  expect(f.read).toHaveBeenCalledOnce();expect(screen.getByRole('status').textContent).toContain('Target not observed');
  expect(screen.queryByText('Laplacian variance')).toBeNull();expect(screen.getByText('2 / 2')).toBeTruthy();
});
it('retains an exportable reference when all actual YOLO observations disappear',async()=>{
  const f=setup();render(<SelectedPixelInspector {...f.props}/>);const index=(await screen.findByText(/^px1-/)).textContent;
  f.frame.objects=[];f.frame.raw_detections=[];f.video.currentTime=.5;await act(async()=>f.video.dispatchEvent(new Event('pause')));
  expect(screen.getByText(/^px1-/).textContent).toBe(index);expect(screen.getByRole('status').textContent).toContain('Target not observed');
  expect((screen.getByRole('button',{name:'Export sample JSON'}) as HTMLButtonElement).disabled).toBe(false);
});
it('distinguishes absent metadata from expired crops without reading playback pixels',async()=>{
  const f=setup();render(<SelectedPixelInspector {...f.props}/>);await screen.findByText(/^px1-/);
  f.read.mockRejectedValue(new Error('expired'));f.video.currentTime=.5;await act(async()=>f.video.dispatchEvent(new Event('pause')));
  expect(screen.getByRole('status').textContent).toContain('YOLO crop unavailable or expired');expect(screen.getByText(/^px1-/)).toBeTruthy();
  expect(ctx.drawImage).not.toHaveBeenCalled();
  f.video.currentTime=3;await act(async()=>f.video.dispatchEvent(new Event('pause')));
  expect(screen.getByRole('status').textContent).toContain('synchronized frame metadata');
});
it('keeps an existing fixed reference when an explicit resample fails',async()=>{
  const f=setup();render(<SelectedPixelInspector {...f.props}/>);const index=(await screen.findByText(/^px1-/)).textContent;
  f.read.mockRejectedValue(new Error('expired'));fireEvent.click(screen.getByRole('button',{name:'Resample'}));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('YOLO crop unavailable or expired'));
  expect(screen.getByText(/^px1-/).textContent).toBe(index);
});
it('uses the matched detector cache frame rather than recropping a newer playback frame',async()=>{
  const f=setup();f.video.currentTime=.3;
  f.props.frames.current.push({...f.frame,time:.3,objects:[],raw_detections:[]});
  const seed={token:'sample:1',classId:0,name:'person',box:[0,0,.125,8/36] as [number,number,number,number],features:f.raw[0].features,time:12,width:8,height:8,evidence:f.raw[0]};
  const estimate={box:seed.box,mode:'detection' as const,similarity:1,reason:'matched' as const,id:null,detection_index:0,cache_id:f.raw[0].cache_id,time:0};
  render(<SelectedPixelInspector {...f.props} selected={seed.token} colorSeed={seed} colorEstimate={estimate}/>);
  await screen.findByText(/^px1-/);expect(f.read).toHaveBeenCalledWith('session:0:0',false);expect(ctx.drawImage).not.toHaveBeenCalled();
  expect(screen.getByText('2 / 2')).toBeTruthy();
});
it('ignores in-flight cached responses after deselection',async()=>{
  const f=setup();let finish!:(r:BboxSnapshot)=>void;
  f.read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const view=render(<SelectedPixelInspector {...f.props}/>);
  view.rerender(<SelectedPixelInspector {...f.props} selected={null}/>);
  await act(async()=>finish({...f.raw[0],rgba_base64:btoa(String.fromCharCode(...red))}));
  expect(screen.queryByText(/^px1-/)).toBeNull();expect(ctx.putImageData).not.toHaveBeenCalled();
});
it('rejects future metadata and localizes controls',()=>{
  const f=setup();f.frame.time=1;
  const view=render(<SelectedPixelInspector {...f.props}/>);expect(f.read).not.toHaveBeenCalled();
  for(const language of ['zh','ja','ko','en'] as const)view.rerender(<SelectedPixelInspector {...f.props} language={language}/>);
  expect(view.container.textContent).not.toMatch(/[\u3400-\u9fff]/);
});
it('only switches candidates on explicit click with the displayed timestamp',async()=>{
  const f=setup(),onSelect=vi.fn();render(<SelectedPixelInspector {...f.props} onSelect={onSelect} timeOffset={12}/>);
  await screen.findByText(/^px1-/);expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Same-class comparison (2)'));
  fireEvent.click(screen.getByRole('button',{name:'Select candidate #0:2'}));expect(onSelect).toHaveBeenCalledExactlyOnceWith('0:2',0);
});
it('cannot seed a reference without retrievable YOLO evidence even when video exists',async()=>{
  const f=setup();f.read.mockRejectedValue(new Error('expired'));render(<SelectedPixelInspector {...f.props}/>);
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('YOLO crop unavailable or expired'));
  expect(screen.queryByText(/^px1-/)).toBeNull();expect(ctx.drawImage).not.toHaveBeenCalled();
});
