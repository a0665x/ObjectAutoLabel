// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StreamDemoPage } from "./StreamDemoPage";
import * as api from "../api/streamDemo";

const player = { append: vi.fn(), end: vi.fn(), dispose: vi.fn(), setPaused: vi.fn() };
vi.mock("./streamPlayer", () => ({ createStreamPlayer: () => player }));
const cli = vi.hoisted(() => ({ props: null as any }));
vi.mock("./CliWorkspace", () => ({ CliWorkspace: (props: any) => { cli.props = props; return null; } }));
const project = { id: "p1", name: "Test", root_path: "/app/data/projects/test", description: "" };
const models = [
  { id: "pt1", conversion_id: "c1", conversion_label: "conversion-001 · car · MuSGD · 86/100 epochs", label: "PT · PyTorch", format: "pt" },
  { id: "onnx1", conversion_id: "c1", conversion_label: "conversion-001 · car · MuSGD · 86/100 epochs", label: "ONNX · ONNX Runtime", format: "onnx" },
  { id: "tflite2", conversion_id: "c2", conversion_label: "conversion-002 · person · Adam · 20 epochs", label: "TFLITE · LiteRT", format: "tflite" }
];
const capabilities = { available: true, missing_plugins: [], cameras: [], cuda: true, mime: "video/mp4", max_upload_bytes: 1024,
  engines: { pt: { available: true }, onnx: { available: true }, tflite: { available: true } } };

class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instance: FakeSocket;
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor() { FakeSocket.instance = this; }
}
beforeEach(() => {
  cli.props = null;
  vi.spyOn(api, "streamRequest").mockImplementation(async (path) => {
    if (path.endsWith("capabilities")) return capabilities as never;
    if (path.endsWith('tracking-settings')) return {defaults:{AI_TRACK_MINIMUM_MATCHING_THRESHOLD:.7,TRACK_MOTION_KALMAN_ENABLE:true,TRACK_MOTION_MAX_PREDICTION_MS:800,TRACKING_BRIDGE_ENABLE:true,TRACKING_BRIDGE_TTL_MS:800,TRACKING_BRIDGE_MAX_MISSES:12},properties:{AI_TRACK_MINIMUM_MATCHING_THRESHOLD:{type:'number',minimum:0,maximum:1},TRACK_MOTION_MAX_PREDICTION_MS:{type:'integer',minimum:0,maximum:5000}}} as never;
    if (path.endsWith('class-schemas')) return [{id:'schema1',name:'Project labels',classes:[{class_id:0,class_name:'pedestrian',descriptors:['person']}]}] as never;
    if (path.endsWith("models")) return models as never;
    if (path.endsWith("inspect-model")) return { id: "external::test", format: "tflite", layout: "NHWC", input_shape: [1,640,640,3], coordinates: "pixels", available: true } as never;
    if (path.endsWith("verify-command")) return { command: "python -c 'print(123)'" } as never;
    return [{ id: "video", name: "clip.mp4", fps: 15, width: 640, height: 360, duration: 5 }] as never;
  });
  vi.stubGlobal("WebSocket", FakeSocket);
});

it('edits paused inference and tracking settings and resumes from the exact displayed position',async()=>{
  render(<StreamDemoPage project={project}/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Start'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Start'}));
  const old=FakeSocket.instance;
  act(()=>{old.onopen?.();old.onmessage?.({data:JSON.stringify({type:'started'})});});
  expect((screen.getByLabelText('FPS') as HTMLInputElement).matches(':disabled')).toBe(true);
  const video=screen.getByLabelText('Detection stream') as HTMLVideoElement;
  video.currentTime=2.437;
  fireEvent.click(screen.getByRole('button',{name:'Pause'}));
  expect((screen.getByLabelText('FPS') as HTMLInputElement).matches(':disabled')).toBe(false);
  expect((screen.getByLabelText('Image size') as HTMLSelectElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('FPS'),{target:{value:'7'}});
  fireEvent.change(screen.getByLabelText('Image size'),{target:{value:'320'}});
  fireEvent.change(screen.getByLabelText('Resolution'),{target:{value:'960'}});
  fireEvent.change(screen.getByRole('slider',{name:'Confidence'}),{target:{value:'.4'}});
  fireEvent.click(screen.getByText('Tracking · motion / topology'));
  fireEvent.click(screen.getByRole('radio',{name:'ByteTrack'}));
  const matching=await screen.findByLabelText('AI_TRACK_MINIMUM_MATCHING_THRESHOLD');
  expect(matching.matches(':disabled')).toBe(false);
  fireEvent.change(matching,{target:{value:'.8'}});
  fireEvent.blur(matching);
  expect(screen.getByRole('button',{name:'Resume'})).toBeTruthy();
  expect(player.setPaused).not.toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByRole('button',{name:'Resume'}));
  expect(old.send).toHaveBeenLastCalledWith(JSON.stringify({type:'stop'}));
  expect(FakeSocket.instance).toBe(old);
  await act(async()=>{old.onclose?.();});
  const next=FakeSocket.instance;expect(next).not.toBe(old);
  act(()=>next.onopen?.());
  expect(JSON.parse(next.send.mock.calls[0][0])).toMatchObject({start_seconds:2.437,fps:7,width:960,imgsz:320,conf:.4,tracking_settings:{AI_TRACK_MINIMUM_MATCHING_THRESHOLD:.8}});
});

it('keeps a paused frame while inspecting another model and resumes with its verified token',async()=>{
  render(<StreamDemoPage project={project}/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Start'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Start'}));
  const old=FakeSocket.instance;
  act(()=>{old.onopen?.();old.onmessage?.({data:JSON.stringify({type:'started',model:{model_id:'pt1',path:'/old.pt',format:'pt'}})});});
  (screen.getByLabelText('Detection stream') as HTMLVideoElement).currentTime=1.234;
  fireEvent.click(screen.getByRole('button',{name:'Pause'}));
  fireEvent.click(screen.getByRole('radio',{name:'Local model path'}));
  expect(screen.getByRole('button',{name:'Resume'})).toBeTruthy();
  expect(old.close).not.toHaveBeenCalled();
  expect((screen.getByRole('button',{name:'Resume'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Model path'),{target:{value:'/app/local.tflite'}});
  fireEvent.click(screen.getByRole('button',{name:'Inspect & use model'}));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Resume'}) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByLabelText('Running model').textContent).toContain('/old.pt');
  fireEvent.click(screen.getByRole('button',{name:'Resume'}));
  await act(async()=>old.onclose?.());
  act(()=>FakeSocket.instance.onopen?.());
  expect(JSON.parse(FakeSocket.instance.send.mock.calls[0][0])).toMatchObject({model_id:'external::test',start_seconds:1.234,device:'cpu'});
});

it('keeps an unchanged paused session when only annotation overlays change',async()=>{
  render(<StreamDemoPage project={project}/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Start'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Start'}));
  const socket=FakeSocket.instance;
  act(()=>{socket.onopen?.();socket.onmessage?.({data:JSON.stringify({type:'started'})});});
  fireEvent.click(screen.getByRole('button',{name:'Pause'}));
  fireEvent.change(screen.getByRole('slider',{name:'Annotation size'}),{target:{value:'8'}});
  fireEvent.click(screen.getByLabelText('Show tracking overlays'));
  fireEvent.click(screen.getByRole('button',{name:'Resume'}));
  expect(FakeSocket.instance).toBe(socket);expect(socket.close).not.toHaveBeenCalled();
  expect(socket.send.mock.calls.some(([data])=>JSON.parse(data).type==='stop')).toBe(false);
  expect(player.setPaused).toHaveBeenLastCalledWith(false);
});

it('rejects invalid paused settings without losing the frame and resumes with the corrected value',async()=>{
  render(<StreamDemoPage project={project}/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Start'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Start'}));
  const socket=FakeSocket.instance;
  act(()=>{socket.onopen?.();socket.onmessage?.({data:JSON.stringify({type:'started'})});});
  (screen.getByLabelText('Detection stream') as HTMLVideoElement).currentTime=2;
  fireEvent.click(screen.getByRole('button',{name:'Pause'}));
  fireEvent.change(screen.getByLabelText('FPS'),{target:{value:'0'}});
  expect((screen.getByRole('button',{name:'Resume'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('FPS'),{target:{value:'15'}});
  fireEvent.click(screen.getByText('Tracking · motion / topology'));
  fireEvent.click(screen.getByRole('radio',{name:'ByteTrack'}));
  const matching=await screen.findByLabelText('AI_TRACK_MINIMUM_MATCHING_THRESHOLD');
  fireEvent.change(matching,{target:{value:'1.5'}});
  expect((screen.getByRole('button',{name:'Resume'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('out-of-range');
  expect(socket.close).not.toHaveBeenCalled();
  fireEvent.change(matching,{target:{value:'.8'}});
  fireEvent.blur(matching);
  expect((screen.getByRole('button',{name:'Resume'}) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Resume'}));
  await act(async()=>socket.onclose?.());
  act(()=>FakeSocket.instance.onopen?.());
  expect(JSON.parse(FakeSocket.instance.send.mock.calls[0][0])).toMatchObject({start_seconds:2,tracking_settings:{AI_TRACK_MINIMUM_MATCHING_THRESHOLD:.8}});
});

it('retains the absolute file position after an earlier seek when paused settings change',async()=>{
  render(<StreamDemoPage project={project}/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Start'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Start'}));
  const first=FakeSocket.instance;
  act(()=>{first.onopen?.();first.onmessage?.({data:JSON.stringify({type:'started'})});});
  fireEvent.change(screen.getByLabelText('Playback time (seconds)'),{target:{value:'3'}});
  fireEvent.click(screen.getByRole('button',{name:'Go'}));
  await act(async()=>first.onclose?.());
  const sought=FakeSocket.instance;
  act(()=>{sought.onopen?.();sought.onmessage?.({data:JSON.stringify({type:'started'})});});
  (screen.getByLabelText('Detection stream') as HTMLVideoElement).currentTime=.237;
  fireEvent.click(screen.getByRole('button',{name:'Pause'}));
  fireEvent.click(screen.getByRole('switch',{name:'Enable tracking · click a box to follow'}));
  fireEvent.click(screen.getByRole('button',{name:'Resume'}));
  await act(async()=>sought.onclose?.());
  act(()=>FakeSocket.instance.onopen?.());
  expect(JSON.parse(FakeSocket.instance.send.mock.calls[0][0])).toMatchObject({start_seconds:3.237,tracking:false});
});

it('inspects a path and uses its model independently of conversion history', async () => {
  render(<StreamDemoPage project={project} />);
  await waitFor(() => expect((screen.getByRole('button', {name:'Start'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('radio', {name:'Local model path'}));
  expect((screen.getByRole('button', {name:'Start'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Model path'), {target:{value:'/app/input_model/old.tflite'}});
  fireEvent.click(screen.getByRole('button', {name:'Inspect & use model'}));
  await waitFor(() => expect(screen.getByText(/TFLITE · NHWC/)).toBeTruthy());
  fireEvent.click(screen.getByRole('button', {name:'Start'}));
  FakeSocket.instance.onopen?.();
  expect(JSON.parse(FakeSocket.instance.send.mock.calls[0][0])).toMatchObject({model_id:'external::test',device:'cpu',tracking:true});
});

it('retires the previous terminal model display when switching to Local model path',async()=>{
  render(<StreamDemoPage project={project}/>);
  await waitFor(()=>expect(cli.props).not.toBeNull());
  await waitFor(()=>expect((screen.getByRole('button',{name:'Start'}) as HTMLButtonElement).disabled).toBe(false));
  const stopDisplay=vi.fn().mockResolvedValue(undefined);cli.props.controlRef.current={stopDisplay};
  await act(async()=>{await cli.props.onDisplayRequest();cli.props.onFrame('blob:old-conversion');});
  expect(screen.getByAltText('Terminal detection stream')).toBeTruthy();
  fireEvent.click(screen.getByRole('radio',{name:'Local model path'}));
  await waitFor(()=>expect(stopDisplay).toHaveBeenCalledOnce());
  expect(screen.queryByAltText('Terminal detection stream')).toBeNull();
});

it('does not change model source if the terminal producer fails to stop',async()=>{
  render(<StreamDemoPage project={project}/>);
  await waitFor(()=>expect(cli.props).not.toBeNull());
  await waitFor(()=>expect((screen.getByRole('button',{name:'Start'}) as HTMLButtonElement).disabled).toBe(false));
  cli.props.controlRef.current={stopDisplay:vi.fn().mockRejectedValue(new Error('Producer still running'))};
  await act(async()=>{await cli.props.onDisplayRequest();cli.props.onFrame('blob:old');});
  fireEvent.click(screen.getByRole('radio',{name:'Local model path'}));
  await screen.findByText('Error: Producer still running');
  expect((screen.getByRole('radio',{name:'Conversion version'}) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByAltText('Terminal detection stream')).toBeTruthy();
});

it('defaults to detections and changes annotation size without restarting inference',async()=>{
  render(<StreamDemoPage project={project}/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Start'}) as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByLabelText('Show tracking overlays') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Start'}));
  const socket=FakeSocket.instance;
  act(()=>{socket.onopen?.();socket.onmessage?.({data:JSON.stringify({type:'started',model:{model_id:'pt1',path:'/actual/model.pt',format:'pt'}})});});
  expect(screen.getByLabelText('Running model').textContent).toContain('/actual/model.pt');
  const sends=socket.send.mock.calls.length;
  fireEvent.change(screen.getByRole('slider',{name:'Annotation size'}),{target:{value:'9'}});
  expect(screen.getByText('9 px')).toBeTruthy();
  expect(socket.send.mock.calls).toHaveLength(sends);
  fireEvent.click(screen.getByLabelText('Show tracking overlays'));
  expect(socket.send.mock.calls).toHaveLength(sends);
});

it('keeps optical-flow preferences independent of tracking overlays and the inference config',async()=>{
  render(<StreamDemoPage project={project}/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Start'}) as HTMLButtonElement).disabled).toBe(false));
  const flow=screen.getByLabelText('Show optical flow') as HTMLInputElement;
  expect(flow.checked).toBe(false);fireEvent.click(flow);
  expect(flow.checked).toBe(true);
  expect((screen.getByLabelText('Show tracking overlays') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(flow);fireEvent.click(screen.getByRole('button',{name:'Start'}));
  act(()=>FakeSocket.instance.onopen?.());
  const config=JSON.parse(FakeSocket.instance.send.mock.calls[0][0]);
  expect(config).toMatchObject({model_id:'pt1',tracking:true});
  expect(config).not.toHaveProperty('flowSettings');expect(config).not.toHaveProperty('optical_flow');
});

it('invalidates an inspected path when editing it without falling back to conversion',async()=>{
  render(<StreamDemoPage project={project}/>);
  await waitFor(()=>expect((screen.getByRole('button',{name:'Start'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('radio',{name:'Local model path'}));
  fireEvent.change(screen.getByLabelText('Model path'),{target:{value:'/app/input_model/a.tflite'}});
  fireEvent.click(screen.getByRole('button',{name:'Inspect & use model'}));
  await waitFor(()=>expect((screen.getByRole('button',{name:'Start'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Model path'),{target:{value:'/app/input_model/b.tflite'}});
  expect((screen.getByRole('button',{name:'Start'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText(/TFLITE · NHWC/)).toBeNull();
});

it('detects project labels and sends the displayed schema ID to inference',async()=>{
  const view=render(<StreamDemoPage project={project}/>);
  await screen.findByText('Project labels · 0: pedestrian');
  fireEvent.click(screen.getByRole('button',{name:'Start'}));
  FakeSocket.instance.onopen?.();
  expect(JSON.parse(FakeSocket.instance.send.mock.calls[0][0]).schema_id).toBe('schema1');
  view.rerender(<StreamDemoPage project={project} language="zh"/>);
  expect(screen.getByLabelText('標籤類別設定')).toBeTruthy();
  expect(screen.getByText('追蹤 · 運動／拓撲')).toBeTruthy();
  expect((screen.getByLabelText('標籤類別設定') as HTMLSelectElement).disabled).toBe(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("selects a conversion before its format and uses CPU for exported artifacts", async () => {
  render(<StreamDemoPage project={project} />);
  await waitFor(() => expect((screen.getByLabelText("Model format") as HTMLSelectElement).value).toBe("pt1"));
  fireEvent.change(screen.getByLabelText("Model format"), { target: { value: "onnx1" } });
  expect((screen.getByLabelText("Device") as HTMLSelectElement).value).toBe("cpu");
  expect((screen.getByLabelText("Device") as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('combobox', {name:'Conversion version'}), { target: { value: "c2" } });
  expect((screen.getByLabelText("Model format") as HTMLSelectElement).value).toBe("tflite2");
  expect(screen.queryByRole("option", { name: "ONNX · ONNX Runtime" })).toBeNull();
});

it('pauses inference and seeks only after the previous session releases its slot', async () => {
  render(<StreamDemoPage project={project} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Start' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  const first = FakeSocket.instance;
  act(() => { first.onopen?.(); first.onmessage?.({ data: JSON.stringify({ type: 'started' }) }); });
  expect(JSON.parse(first.send.mock.calls[0][0])).toMatchObject({ tracking: true, start_seconds: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  expect(player.setPaused).toHaveBeenLastCalledWith(true);
  expect(first.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'playback', paused: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
  expect(player.setPaused).toHaveBeenLastCalledWith(false);
  fireEvent.change(screen.getByLabelText('Playback time (seconds)'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Go' }));
  expect(FakeSocket.instance).toBe(first);
  expect(first.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'stop' }));
  await act(async () => { first.onclose?.(); });
  expect(FakeSocket.instance).not.toBe(first);
  FakeSocket.instance.onopen?.();
  expect(JSON.parse(FakeSocket.instance.send.mock.calls[0][0])).toMatchObject({ start_seconds: 3 });
});

it("sends selected model and live thresholds, and closes the stream on page exit", async () => {
  const view = render(<StreamDemoPage project={project} />);
  const start = screen.getByRole("button", { name: "Start" });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(start);
  const socket = FakeSocket.instance;
  socket.onopen?.();
  expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ model_id: "pt1", source_id: "video", device: "0", fps: 15, bitrate: 2000 });
  act(()=>socket.onmessage?.({data:JSON.stringify({type:'started'})}));
  fireEvent.change(screen.getByRole("slider", { name: "Confidence" }), { target: { value: "0.65" } });
  expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({ thresholds: { conf: .65, iou: .7 } });
  view.unmount();
  expect(socket.close).toHaveBeenCalledOnce();
  expect(player.dispose).toHaveBeenCalledOnce();
});

it("keeps Start disabled when no host camera mode exists", async () => {
  render(<StreamDemoPage project={project} />);
  await waitFor(() => expect((screen.getByLabelText("Model format") as HTMLSelectElement).value).toBe("pt1"));
  fireEvent.click(screen.getByLabelText("Host camera"));
  expect(screen.getByText("No host cameras detected.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(true);
});

it("shares one monitor and waits for each producer to stop before switching", async () => {
  render(<StreamDemoPage project={project} />);
  await waitFor(() => expect(cli.props).not.toBeNull());
  await waitFor(() => expect((screen.getByRole("button", { name: "Start" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  const live = FakeSocket.instance;
  let preparing: Promise<void>;
  act(() => { preparing = cli.props.onDisplayRequest(); });
  expect(live.send).toHaveBeenCalledWith(JSON.stringify({ type: "stop" }));
  expect(screen.queryByAltText("Terminal detection stream")).toBeNull();
  await act(async () => { live.onclose?.(); await preparing; cli.props.onFrame("blob:test"); });
  expect(screen.getByAltText("Terminal detection stream").closest(".stream-video")).toBeTruthy();
  let release!: () => void;
  cli.props.controlRef.current = { stopDisplay: () => new Promise<void>((resolve) => { release = resolve; }) };
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  expect(FakeSocket.instance).toBe(live);
  await act(async () => { release(); });
  expect(FakeSocket.instance).not.toBe(live);
  expect(screen.queryByAltText("Terminal detection stream")).toBeNull();
});

it("keeps visible upload completion feedback and marks the selected video ready", async () => {
  vi.spyOn(api, "uploadStreamVideo").mockResolvedValue({ id: "new-video", name: "new.mp4", fps: 30, width: 1280, height: 720, duration: 5, bytes: 5 });
  render(<StreamDemoPage project={project} />);
  await waitFor(() => expect((screen.getByLabelText("Model format") as HTMLSelectElement).value).toBe("pt1"));
  fireEvent.change(screen.getByLabelText("Upload video"), { target: { files: [new File(["video"], "new.mp4", { type: "video/mp4" })] } });
  await waitFor(() => expect(screen.getByText("Uploaded: new.mp4")).toBeTruthy());
  expect(document.querySelector('.stream-monitor-bar [role="status"]')?.textContent).toBe("Ready");
  expect((screen.getByLabelText("Video") as HTMLSelectElement).value).toBe("new-video");
});

it("reports upload failure next to the file controls and permits retry", async () => {
  vi.spyOn(api, "uploadStreamVideo").mockRejectedValue(new Error("Video upload timed out"));
  render(<StreamDemoPage project={project} />);
  await waitFor(() => expect((screen.getByLabelText("Model format") as HTMLSelectElement).value).toBe("pt1"));
  fireEvent.change(screen.getByLabelText("Upload video"), { target: { files: [new File(["video"], "new.mp4")] } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Video upload timed out"));
  expect(screen.getByRole("alert").closest(".stream-settings")).not.toBeNull();
  expect(screen.getByLabelText("Upload video").closest("fieldset")?.disabled).toBe(false);
});

it("copies a standalone Python command and disables IoU for detected NMS-free output", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  render(<StreamDemoPage project={project} />);
  const copy = screen.getByRole("button", { name: "Copy Python command", hidden: true });
  await waitFor(() => expect((copy as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(copy);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("python -c 'print(123)'"));
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  act(() => FakeSocket.instance.onmessage?.({ data: JSON.stringify({ type: "stats", postprocess: "NMS-free", fps: 10, frames: 1, detections: 2, inference_ms: 3 }) }));
  expect((screen.getByRole("slider", { name: "IoU" }) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole("slider", { name: "Confidence" }) as HTMLInputElement).disabled).toBe(false);
});
