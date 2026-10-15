// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { frameAt, StreamTrackingOverlay } from './StreamTrackingOverlay';

afterEach(cleanup);
it('keeps annotation size in screen pixels across viewport changes',()=>{
  const video={current:document.createElement('video')};video.current.currentTime=2;
  const bounds=vi.spyOn(SVGElement.prototype,'getBoundingClientRect').mockReturnValue({width:320} as DOMRect);
  const props={video,frames:{current:[frame]},selected:null,onSelect:vi.fn(),onTime:vi.fn(),active:true};
  const view=render(<StreamTrackingOverlay {...props} annotationSize={10}/>);
  const svg=view.container.querySelector('svg')!;
  expect(svg.style.getPropertyValue('--stream-label-size')).toBe('20px');
  view.rerender(<StreamTrackingOverlay {...props} annotationSize={8}/>);
  expect(svg.style.getPropertyValue('--stream-label-size')).toBe('16px');
  bounds.mockReturnValue({width:640} as DOMRect);
  fireEvent(window,new Event('resize'));
  expect(svg.style.getPropertyValue('--stream-label-size')).toBe('8px');
  bounds.mockRestore();
});
const frame = { time: 2, width: 640, height: 360, objects: [{ id: '0:7', name: 'person', class_id: 0, score: .9, box: [100, 100, 150, 200] }] };

it('updates both box diagnostics and selected-target text on every language change without replacing frames', () => {
  const video = { current: document.createElement('video') }; video.current.currentTime = 2;
  const props = { video, frames: {current: [frame]}, selected: '0:7', onSelect: vi.fn(), onTime: vi.fn(), active: true,
    viz: {enabled:true,trails: true, prediction: true, topology: true, diagnostics: true} };
  const view = render(<StreamTrackingOverlay {...props} language="zh" />);
  expect(view.container.querySelector('.stream-motion-label')?.textContent).toContain('原始 0:7');
  for (const [language, raw] of [['en','raw'],['ja','元ID'],['ko','원본'],['zh','原始'],['en','raw']] as const) {
    view.rerender(<StreamTrackingOverlay {...props} language={language} />);
    expect(view.container.querySelector('.stream-motion-label')?.textContent).toContain(`${raw} 0:7`);
    expect(view.container.querySelector('.stream-identity-debug')?.textContent).toContain(raw);
    if (language === 'en') expect(view.container.textContent).not.toMatch(/[\u3400-\u9fff]/);
  }
});

it('uses displayed video time, never a future or stale tracking frame', () => {
  expect(frameAt([frame], 1.9)).toBeUndefined();
  expect(frameAt([frame], 2.03)).toBe(frame);
  expect(frameAt([frame], 2.5)).toBeUndefined();
});

it('selects a visible ID by pointer or keyboard and marks it red with a text label', () => {
  const video = { current: document.createElement('video') };
  video.current.currentTime = 2;
  const onSelect = vi.fn(), onTime = vi.fn();
  const props = { video, frames: { current: [frame] }, onSelect, onTime, active: true };
  const view = render(<StreamTrackingOverlay {...props} selected={null} />);
  fireEvent.click(screen.getByRole('button', { name: 'Track person 0:7' }));
  expect(onSelect).toHaveBeenLastCalledWith('0:7',2);
  view.rerender(<StreamTrackingOverlay {...props} selected="0:7" />);
  expect(screen.getByRole('button').closest('g')?.classList.contains('selected')).toBe(true);
  expect(screen.getByRole('status').textContent).toBe('Tracking #0:7');
  fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
  expect(onSelect).toHaveBeenLastCalledWith(null,2);
  video.current.currentTime = 3;
  fireEvent.timeUpdate(video.current);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('lost');
});

it('retains low-FPS metadata for the duration of the displayed frame',()=>{
  const slow={...frame,dt_ms:1000};
  expect(frameAt([slow],2.9)).toBe(slow);
  expect(frameAt([slow],3.1)).toBeUndefined();
});

it('shows low-FPS detections without a confirmed ID, but does not make them selectable tracks',()=>{
  const video={current:document.createElement('video')};video.current.currentTime=2.9;
  const onSelect=vi.fn();
  const detectionFrame={...frame,dt_ms:1000,objects:[{...frame.objects[0],id:null,tracked:false,detection_index:0},{...frame.objects[0],id:'0:8',box:[200,100,250,200]}]};
  const view=render(<StreamTrackingOverlay video={video} frames={{current:[detectionFrame]}} selected={null} onSelect={onSelect} onTime={vi.fn()} active/>);
  expect(view.container.querySelectorAll('.stream-track rect')).toHaveLength(2);
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(view.container.textContent).toContain('Detected');
  expect(view.container.textContent).not.toContain('#null');
  fireEvent.click(view.container.querySelector('.stream-detection-only rect')!);
  expect(onSelect).not.toHaveBeenCalled();
});

it('toggles real diagnostic geometry without intercepting box selection',()=>{
  const video={current:document.createElement('video')};video.current.currentTime=2;
  const diagnostic={...frame,objects:[{...frame.objects[0],raw_id:'0:8',trail:[[110,120],[115,125]],anchors:[{raw_id:'1:1',dx_norm:.1,dy_norm:0}],uncertainty:{center:[115,125],radii:[4,6],angle:0}}]};
  const props={video,frames:{current:[diagnostic]},selected:'0:7',onSelect:vi.fn(),onTime:vi.fn(),active:true};
  const view=render(<StreamTrackingOverlay {...props} viz={{enabled:true,trails:true,prediction:true,topology:true,diagnostics:true}}/>);
  expect(view.container.querySelectorAll('.stream-topology-link')).toHaveLength(1);
  expect(view.container.querySelectorAll('ellipse')).toHaveLength(1);
  expect(view.container.querySelectorAll('polyline')).toHaveLength(1);
  expect(screen.getByLabelText('Diagnostics · IDs / timing / matching').textContent).toContain('raw 0:8');
  view.rerender(<StreamTrackingOverlay {...props} viz={{enabled:true,trails:false,prediction:false,topology:false,diagnostics:false}}/>);
  expect(view.container.querySelector('ellipse,polyline,.stream-topology-link')).toBeNull();
});

it('a disabled tracking overlay keeps observed detections but hides trails, predictions, topology and IDs',()=>{
  const video={current:document.createElement('video')};video.current.currentTime=2;
  const observed={...frame.objects[0],trail:[[110,120],[115,125]],anchors:[{raw_id:'1:1',dx_norm:.1,dy_norm:0}],forecast:{bbox:[.2,.2,.3,.4],horizon_ms:100},uncertainty:{center:[115,125],radii:[4,6],angle:0}};
  const props={video,frames:{current:[{...frame,objects:[observed,{...observed,id:'0:9',predicted:true}]}]},selected:'0:7',onSelect:vi.fn(),onTime:vi.fn(),active:true};
  const view=render(<StreamTrackingOverlay {...props} viz={{enabled:false,trails:true,prediction:true,topology:true,diagnostics:true}}/>);
  expect(view.container.querySelector('ellipse,polyline,.stream-topology-link,.stream-kalman-forecast,.stream-motion-label')).toBeNull();
  expect(view.container.querySelectorAll('.stream-track rect')).toHaveLength(1);
  expect(view.container.textContent).toContain('person');expect(view.container.textContent).toContain('0.90');expect(view.container.textContent).not.toContain('#0:7');
});
