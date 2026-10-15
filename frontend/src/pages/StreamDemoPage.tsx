import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Film, Play, Square, RefreshCw, Upload, Trash2, Maximize, Copy, Check, Code } from "lucide-react";
import type { Project, Language, ClassSchema } from "../types";
import { StreamSegments, StreamSwitch } from './StreamControls';
import { streamUiText, type StreamUiKey } from './streamUiText';
import { trackingText,trackingVisualizationHelp } from './trackingText';
import { streamRequest, uploadStreamVideo, type StreamCapabilities, type StreamModel, type StreamUpload } from "../api/streamDemo";
import { createStreamPlayer } from "./streamPlayer";
import { StreamTrackingOverlay, type TrackingFrame } from "./StreamTrackingOverlay";
import {StreamOpticalFlowOverlay} from './StreamOpticalFlowOverlay';
import {OpticalFlowPanel} from './OpticalFlowPanel';
import {defaultFlowSettings,type FlowSettings,type FlowSummary} from './opticalFlowModel';
import { TrackingSettingsPanel, type TrackingSettings, type TrackingViz, type TrackingDisplayStatus } from './TrackingSettingsPanel';
import type { CliControl } from "./CliWorkspace";
import {useWorkflow} from '../workflow/WorkflowState';
import {api as projectApi} from '../api/client';
const CliWorkspace = lazy(() => import("./CliWorkspace").then((module) => ({ default: module.CliWorkspace })));

export function StreamDemoPage({ project, language='en' }: { project: Project; language?:Language }) {
  const runtime=useWorkflow();
  const s=(key:StreamUiKey)=>streamUiText(language,key);
  const t=(key:Parameters<typeof trackingText>[1])=>trackingText(language,key);
  const [labelSchemas,setLabelSchemas]=useState<ClassSchema[]>([]);
  const [schemaId,setSchemaId]=useState('auto');
  const [schemaError,setSchemaError]=useState(false);
  const cliControl = useRef<CliControl | null>(null);
  const [cliFrame, setCliFrame] = useState("");
  const [cliActive, setCliActive] = useState(false);
  const cliActiveRef = useRef(false);
  const starting = useRef(false);
  const generation = useRef(0);
  const [caps, setCaps] = useState<StreamCapabilities>();
  const [models, setModels] = useState<StreamModel[]>([]);
  const [uploads, setUploads] = useState<StreamUpload[]>([]);
  const [conversionId, setConversionId] = useState("");
  const [conversionModelId, setModelId] = useState("");
  const [modelMode, setModelMode] = useState("conversion");
  const [modelPath, setModelPath] = useState("");
  const [coordinates, setCoordinates] = useState("auto");
  const [externalModel, setExternalModel] = useState<StreamModel>();
  const [inspecting, setInspecting] = useState(false);
  const modelId = modelMode === "path" ? externalModel?.id ?? "" : conversionModelId;
  const [source, setSource] = useState<"upload" | "camera">("upload");
  const [uploadId, setUploadId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [cameraMode, setCameraMode] = useState("");
  const [width, setWidth] = useState(640);
  const [fps, setFps] = useState(15);
  const [bitrate, setBitrate] = useState(2000);
  const [imgsz, setImgsz] = useState(640);
  const [device, setDevice] = useState("0");
  const [conf, setConf] = useState(0.25);
  const [iou, setIou] = useState(0.7);
  const [annotationSize,setAnnotationSize]=useState(12);
  const [runningModel,setRunningModel]=useState<{model_id:string;path:string;format:string}>();
  const [displayStatus,setDisplayStatus]=useState<TrackingDisplayStatus>();
  const [state, setState] = useState("Idle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [stats, setStats] = useState<{fps:number;inference_ms:number;frames:number;detections:number;tracks?:number;untracked?:number}>({ fps: 0, inference_ms: 0, frames: 0, detections: 0 });
  const [postprocess, setPostprocess] = useState("Auto");
  const [tracking, setTracking] = useState(true);
  const [trackingSettings,setTrackingSettings] = useState<TrackingSettings>({});
  const [trackingViz,setTrackingViz] = useState<TrackingViz>({enabled:false,trails:true,prediction:true,topology:true,diagnostics:false});
  const [flowSettings,setFlowSettings]=useState<FlowSettings>(defaultFlowSettings);
  const [flowSummary,setFlowSummary]=useState<FlowSummary>();
  const [flowReset,setFlowReset]=useState(0);
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const trackingFrames = useRef<TrackingFrame[]>([]);
  const [paused, setPaused] = useState(false);
  const pausePosition=useRef(0);
  const [appliedConfigKey,setAppliedConfigKey]=useState('');
  const [trackingValid,setTrackingValid]=useState(true);
  const previousSource=useRef('');
  const [position, setPosition] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [jumpTime, setJumpTime] = useState(0);
  const offset = useRef(0);
  const updateTime = useCallback((time: number) => setPosition(Math.round((offset.current + time) * 10) / 10), []);
  const [command, setCommand] = useState("");
  const [commandError, setCommandError] = useState("");
  const [copied, setCopied] = useState(false);
  const commandRef = useRef<HTMLTextAreaElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<ReturnType<typeof createStreamPlayer> | null>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const busy = state === "Connecting" || state === "Live";
  const editingLocked=state==='Connecting'||(state==='Live'&&!paused);
  const selectedModel = modelMode === "path" ? externalModel : models.find((model) => model.id === modelId);
  const autoSchema=labelSchemas.find(s=>s.id===selectedModel?.schema_id) ?? (labelSchemas.length===1?labelSchemas[0]:undefined);
  const selectedSchema=schemaId==='auto'?autoSchema:labelSchemas.find(s=>s.id===schemaId);
  const camera = caps?.cameras.find((item) => item.id === cameraId);
  const mode = camera?.modes.find((item) => item.id === cameraMode);
  const upload = uploads.find((item) => item.id === uploadId);
  const engine = selectedModel && caps?.engines[selectedModel.format];
  const conversions = Array.from(new Map(models.map((model) => [model.conversion_id, model.conversion_label])));
  const effectiveDevice = selectedModel?.format === "pt" && caps?.cuda ? device : "cpu";
  const config={model_id:modelId,source,source_id:source==='upload'?uploadId:cameraId,
    camera_mode:cameraMode,width,fps,bitrate,conf,iou,imgsz,device:effectiveDevice,tracking,
    tracking_settings:Object.fromEntries(Object.entries(trackingSettings).sort(([a],[b])=>a.localeCompare(b))),
    schema_id:schemaId==='auto'?(selectedSchema?.id??'model'):schemaId};
  const configKey=JSON.stringify(config);
  const pendingSettings=paused&&Boolean(appliedConfigKey)&&configKey!==appliedConfigKey;
  const invalidConfig=inspecting||loading||(schemaError&&schemaId!=='model')||progress!==null||!caps?.available||
    selectedModel?.available===false||!engine?.available||!modelId||(source==='upload'?!uploadId:!cameraMode)||
    !Number.isInteger(fps)||fps<1||fps>60||!Number.isInteger(bitrate)||bitrate<100||bitrate>20000||!trackingValid;

  function dispose() {
    generation.current += 1;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) { socket.onclose = null; socket.onmessage = null; socket.onerror = null; socket.onopen = null; socket.close(); }
    playerRef.current?.dispose();
    playerRef.current = null;
    trackingFrames.current = [];
    setSelectedTrack(null);
    setRunningModel(undefined);
    setDisplayStatus(undefined);
    setAppliedConfigKey('');
  }
  async function releaseStream() {
    const socket = socketRef.current;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => { dispose(); reject(new Error("Stream did not stop; retry playback")); }, 15000);
      socket.onmessage = null; socket.onerror = null;
      socket.onclose = () => { window.clearTimeout(timeout); resolve(); };
      const requestStop = () => socket.send(JSON.stringify({ type: "stop" }));
      if (socket.readyState === WebSocket.OPEN) requestStop(); else socket.onopen = requestStop;
    });
  }
  function togglePause() {
    if(paused&&pendingSettings){void start(pausePosition.current);return;}
    const value = !paused;
    playerRef.current?.setPaused(value);
    if(value){pausePosition.current=offset.current+(videoRef.current?.currentTime??0);setPosition(Math.round(pausePosition.current*10)/10);}
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "playback", paused: value }));
    setPaused(value);
  }
  function stop() {
    dispose();
    offset.current = 0; setPosition(0); setJumpTime(0); setSeekDraft(null); setPaused(false);
    void cliControl.current?.stopDisplay().then(() => { cliActiveRef.current = false; setCliActive(false); setCliFrame(""); setState("Stopped"); }).catch((reason) => setError(String(reason)));
    if (!cliActiveRef.current) setState("Stopped");
  }
  async function prepareCliDisplay() {
    const socket = socketRef.current;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => { dispose(); reject(new Error("Stream did not stop; terminal display was not started")); }, 15000);
        socket.onmessage = null; socket.onerror = null;
        socket.onclose = () => { window.clearTimeout(timeout); resolve(); };
        const requestStop = () => socket.send(JSON.stringify({ type: "stop" }));
        if (socket.readyState === WebSocket.OPEN) requestStop(); else socket.onopen = requestStop;
      });
    }
    dispose(); setError(""); setCliFrame(""); cliActiveRef.current = true; setCliActive(true); setState("Terminal");
    setStats({ fps: 0, inference_ms: 0, frames: 0, detections: 0 }); setPostprocess("Auto");
  }
  function fail(message: string) { dispose(); setError(message); setState("Failed"); }

  async function changeModelMode(value:string) {
    if(value===modelMode)return;
    if(paused&&source==='upload'&&!cliActiveRef.current){setError('');setModelMode(value);return;}
    setInspecting(true);
    try {
      // Terminal commands own their model; retire that producer before letting
      // a new Web UI model selection appear to control the previous frames.
      if(cliActiveRef.current) {
        await cliControl.current?.stopDisplay();
        cliActiveRef.current=false;setCliActive(false);setCliFrame('');
      }
      dispose();setError('');setModelMode(value);
      setState((source==='upload'?uploadId:cameraMode)?'Ready':'Idle');
      setStats({fps:0,inference_ms:0,frames:0,detections:0});
    } catch(reason) {setError(String(reason));}
    finally {setInspecting(false);}
  }

  async function refresh() {
    setLoading(true);
    setError("");
    setSchemaError(false);
    try {
      const [nextCaps, nextModels, nextUploads, nextSchemas] = await Promise.all([
        streamRequest<StreamCapabilities>("/api/stream-demo/capabilities"),
        streamRequest<StreamModel[]>(`/api/projects/${project.id}/stream-demo/models`),
        streamRequest<StreamUpload[]>(`/api/projects/${project.id}/stream-demo/uploads`),
        streamRequest<ClassSchema[]>(`/api/projects/${project.id}/class-schemas`).catch(()=>{setSchemaError(true);return [] as ClassSchema[];})
      ]);
      setCaps(nextCaps); setModels(nextModels); setUploads(nextUploads);
      setLabelSchemas(nextSchemas);
      setSchemaId(value=>value==='auto'||value==='model'||nextSchemas.some(s=>s.id===value)?value:'auto');
      const usable = nextModels.filter((model) => model.available !== false);
      const assigned=runtime?.state?.assignments.conversion;
      const initial=runtime?usable.find(m=>m.conversion_id===assigned):usable[0];
      setConversionId((value) => runtime?assigned??'':nextModels.some((m) => m.conversion_id === value) ? value : initial?.conversion_id ?? nextModels[0]?.conversion_id ?? "");
      setModelId((value) => nextModels.some((m) => m.id === value && m.available !== false && (!runtime||m.conversion_id===assigned)) ? value : initial?.id ?? (!runtime?nextModels[0]?.id:'') ?? "");
      setUploadId((value) => nextUploads.some((u) => u.id === value) ? value : nextUploads[0]?.id ?? "");
      setCameraId((value) => nextCaps.cameras.some((c) => c.id === value) ? value : nextCaps.cameras[0]?.id ?? "");
    } catch (reason) { setError(String(reason)); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void refresh();
    return () => { dispose(); uploadRef.current?.abort(); };
  }, [project.id]);
  useEffect(() => { setCameraMode(camera?.modes[0]?.id ?? ""); }, [cameraId, caps]);
  useEffect(()=>{
    if(!runtime?.state||modelMode!=='conversion')return;
    const assigned=runtime.state.assignments.conversion??'';
    setConversionId(assigned);
    setModelId(current=>models.some(model=>model.id===current&&model.conversion_id===assigned&&model.available!==false)?current:models.find(model=>model.conversion_id===assigned&&model.available!==false)?.id??'');
  },[runtime?.state?.assignments.conversion,Boolean(runtime?.state),models,modelMode]);
  useEffect(() => { if (mode) setFps((value) => Math.max(1, Math.min(value, Math.floor(mode.fps)))); }, [cameraMode]);
  useEffect(() => {
    if (!paused&&state==='Live'&&socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ thresholds: { conf, iou } }));
      setAppliedConfigKey(configKey);
    }
  }, [conf, iou, paused, state]);
  useEffect(() => { setPostprocess("Auto"); }, [modelId]);
  useEffect(() => {
    if (cliActiveRef.current) return;
    const sourceKey=JSON.stringify([source,uploadId,cameraMode]);
    const sameSource=previousSource.current===sourceKey;previousSource.current=sourceKey;
    // Model/schema controls are drafts while paused. Keep the old producer and
    // displayed frame until Resume can replace them using the latest config.
    if(paused&&source==='upload'&&sameSource&&appliedConfigKey)return;
    dispose();
    offset.current = 0; setPosition(0); setJumpTime(0); setSeekDraft(null); setPaused(false);
    setState((source === "upload" ? uploadId : cameraMode) ? "Ready" : "Idle");
    setStats({ fps: 0, inference_ms: 0, frames: 0, detections: 0 });
  }, [source, uploadId, cameraMode, modelId, schemaId]);
  useEffect(() => {
    setCommand(""); setCommandError(""); setCopied(false);
    if (modelMode === "path") return;
    if (!modelId || !(source === "upload" ? uploadId : cameraId)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void streamRequest<{ command: string }>(`/api/projects/${project.id}/stream-demo/verify-command`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId, source, source_id: source === "upload" ? uploadId : cameraId,
          camera_mode: cameraMode, conf, iou, imgsz, fps, device: effectiveDevice })
      }).then((response) => { if (!cancelled) setCommand(response.command); })
        .catch((reason) => { if (!cancelled) setCommandError(String(reason)); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [project.id, modelId, source, uploadId, cameraId, cameraMode, conf, iou, imgsz, fps, effectiveDevice]);

  async function copyCommand() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(command);
      else {
        commandRef.current?.focus(); commandRef.current?.select();
        if (!document.execCommand("copy")) throw new Error("Clipboard unavailable; select the command to copy");
      }
      setCopied(true);
    } catch (reason) { setCommandError(String(reason)); }
  }

  async function start(startSeconds = 0) {
    if (invalidConfig || starting.current || !caps || !videoRef.current || !selectedModel) return;
    starting.current = true;
    const requestedGeneration = generation.current;
    setState("Connecting");
    try {
      if (cliControl.current) await cliControl.current.stopDisplay();
      if (socketRef.current) await releaseStream();
    }
    catch (reason) { starting.current = false; setState("Failed"); setError(String(reason)); return; }
    if (generation.current !== requestedGeneration || !videoRef.current) { starting.current = false; return; }
    cliActiveRef.current = false; setCliActive(false); setCliFrame("");
    dispose(); setError(""); setState("Connecting"); setPostprocess("Auto"); setStats({ fps: 0, inference_ms: 0, frames: 0, detections: 0 });
    offset.current = startSeconds; setPosition(startSeconds); setSeekDraft(null); setPaused(false);
    try {
      playerRef.current = createStreamPlayer(videoRef.current, caps.mime, fail, source === "camera");
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/projects/${project.id}/stream-demo/live`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      setAppliedConfigKey(configKey);
      let ended = false;
      socket.onopen = () => socket.send(JSON.stringify({...config,start_seconds:startSeconds}));
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) { playerRef.current?.append(event.data); return; }
        const message = JSON.parse(event.data);
        if (message.type === "tracks") {
          trackingFrames.current.push(message);
          if (trackingFrames.current.length > 3600) trackingFrames.current.shift();
          return;
        }
        if (message.postprocess) setPostprocess(message.postprocess);
        if (message.type === "started") {setState("Live");setRunningModel(message.model);}
        if (message.type === "stats") setStats(message);
        if (message.type === "ended") { ended = true; setStats(message); setState("Completed"); playerRef.current?.end(); }
        if (message.type === "error") fail(message.message);
      };
      socket.onerror = () => fail("Stream connection failed");
      socket.onclose = () => {
        if (socketRef.current === socket) { socketRef.current = null; if (!ended) fail("Stream disconnected"); }
      };
    } catch (reason) { fail(String(reason)); }
    finally { starting.current = false; }
  }

  function seek(seconds: number) {
    if (source !== "upload" || !upload || state === "Connecting" || cliActive) return;
    void start(Math.max(0, Math.min(seconds, Math.max(0, upload.duration - 1 / fps))));
  }

  function selectTrack(id: string | null, time = videoRef.current?.currentTime ?? 0) {
    setSelectedTrack(id);
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({type:'select_track',id,time}));
  }

  async function uploadVideo(file?: File) {
    if (!file) return;
    setUploadNotice(""); setUploadError(""); setUploadName(file.name);
    if (!caps) { setUploadError("Video services are still loading"); return; }
    if (!/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name)) { setUploadError("Select an MP4, MOV, MKV, WebM, AVI, or M4V video file"); return; }
    if (!file.size) { setUploadError("The selected video file is empty"); return; }
    if (caps.max_upload_bytes !== null && file.size > caps.max_upload_bytes) { setUploadError("Video exceeds the configured upload limit"); return; }
    const controller = new AbortController(); uploadRef.current = controller;
    setProgress(0); setError("");
    try {
      const item = await uploadStreamVideo(project.id, file, setProgress, controller.signal);
      setUploads((items) => [item, ...items]); setUploadId(item.id);
      setUploadNotice(`Uploaded: ${item.name}`);
    } catch (reason) { setUploadError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setProgress(null); uploadRef.current = null; }
  }

  return <section className="stream-demo" aria-labelledby="stream-heading">
    <header className="stream-header"><h2 id="stream-heading"><Film size={22} />Stream Demo</h2>
      <button type="button" className="secondary" title={s('refresh')} aria-label={s('refresh')} disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={17} /></button>
    </header>
    {error && <p className="review-error" role="alert">{error}</p>}
    {caps && !caps.available && <p className="review-error" role="alert">GStreamer unavailable: {caps.missing_plugins.join(", ")}</p>}
    <div className="stream-setup-grid"><div className="stream-setup-card workflow-inputs">
    <StreamSegments label={s('modelSource')} value={modelMode} disabled={editingLocked || inspecting}
      onChange={value=>void changeModelMode(value)} options={[{value:'conversion',label:s('conversion')},{value:'path',label:s('path')}]}/>
    {modelMode === "conversion" ? <div className="stream-models">
      <label>{s('conversion')}<select aria-label={s('conversion')} value={conversionId} disabled={editingLocked || loading} onChange={(event) => {
        const id=event.target.value;
        if(runtime)void runtime.change(()=>projectApi.assignWorkflow(project.id,'conversion',id));
        else{setConversionId(id);setModelId(models.find((m) => m.conversion_id === id && m.available !== false)?.id ?? models.find((m) => m.conversion_id === id)?.id ?? "");}
      }}><option value="" disabled>{loading ? s('loading') : s('selectConversion')}</option>{conversions.map(([id, label]) => <option key={id} value={id}>{label.split(" · ")[0]}</option>)}</select></label>
      <label>{s('format')}<select aria-label={s('format')} value={modelId} disabled={editingLocked || loading} onChange={(event) => setModelId(event.target.value)}>
        <option value="" disabled>{s('selectFormat')}</option>{models.filter((m) => m.conversion_id === conversionId).map((model) => { const unavailable = model.available === false || !caps?.engines[model.format].available; return <option key={model.id} value={model.id} disabled={unavailable}>{model.label.split(' · ').slice(0,2).join(' · ')}{unavailable ? ` · ${s('unavailable')}` : ''}</option>; })}
      </select></label>
    </div> : <fieldset className="stream-local-model" disabled={editingLocked || inspecting}><legend>{s('localModel')}</legend>
      <label>{s('modelPath')}<input type="text" aria-label={s('modelPath')} value={modelPath} placeholder="/app/input_model/model.onnx" onChange={e => { setModelPath(e.target.value); setExternalModel(undefined); }} /></label>
      <label>{s('coordinates')}<select aria-label={s('coordinates')} value={coordinates} onChange={e => { setCoordinates(e.target.value); setExternalModel(undefined); }}><option value="auto">{s('auto')}</option><option value="pixels">{s('pixels')}</option><option value="normalized">{s('normalized')}</option></select></label>
      <button type="button" className="secondary" disabled={!modelPath.trim()} onClick={async () => {
        setInspecting(true); setError(""); setExternalModel(undefined);
        try { setExternalModel(await streamRequest<StreamModel>(`/api/projects/${project.id}/stream-demo/inspect-model`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: modelPath.trim(), coordinates }) })); }
        catch (err) { setError(err instanceof Error ? err.message : "Model inspection failed"); }
        finally { setInspecting(false); }
      }}>{inspecting ? s('inspecting') : s('inspect')}</button>
      <p className="muted">{s('pathHint')}</p>
      {externalModel && <p role="status">{externalModel.format.toUpperCase()} · {externalModel.layout} · input [{externalModel.input_shape?.join(", ")}] · output [{externalModel.output_shape?.join(", ") ?? "native YOLO"}] · {externalModel.coordinates}</p>}
      {externalModel && <p className="stream-lineage">{t(paused?'verifiedPausedModel':'verifiedModel')}: {externalModel.conversion_label}</p>}
    </fieldset>}
    {selectedModel?.conversion_label && <details className="stream-model-details"><summary>{s('modelDetails')}</summary><p className="stream-lineage">{selectedModel.conversion_label}</p><p className="stream-lineage">{selectedModel.label}</p></details>}
    {modelMode === "conversion" && !loading && !models.length && <p className="muted">{s('noModels')}</p>}
    {selectedModel?.available === false && <p className="review-error">Model unavailable: {selectedModel.reason}</p>}
    </div><div className="stream-label-schema stream-setup-card">
      <label>{t('schema')}<select aria-label={t('schema')} value={schemaId} disabled={editingLocked||loading} onChange={e=>setSchemaId(e.target.value)}>
        <option value="auto">{t('auto')}</option><option value="model">{t('native')}</option>
        {labelSchemas.map(s=><option key={s.id} value={s.id}>{s.name} · {s.id.slice(0,8)}</option>)}
      </select></label>
      {selectedSchema && <p className="stream-lineage">{selectedSchema.name} · {selectedSchema.classes.map(c=>`${c.class_id}: ${c.class_name}`).join(' · ')}</p>}
      <small>{t('schemaHint')}</small>
      {schemaError?<p role="alert" className="review-error">{t('schemaError')}</p>:schemaId==='auto'&&!autoSchema&&<p className="muted">{t(labelSchemas.length?'schemaAmbiguous':'schemaNone')}</p>}
    </div>
    </div>
    <div className="stream-layout">
      <div className="stream-settings">
        <fieldset disabled={busy || loading || progress !== null}><legend>{s('source')}</legend>
          <StreamSegments label={s('source')} hideLabel value={source} onChange={value=>setSource(value as 'upload'|'camera')}
            options={[{value:'upload',label:s('videoFile')},{value:'camera',label:s('hostCamera')}]}/>
          {source === "upload" ? <>
            <label>{s('video')}<select aria-label={s('video')} value={uploadId} onChange={(event) => setUploadId(event.target.value)}><option value="">{s('selectVideo')}</option>{uploads.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <div className="stream-upload-actions"><label className="stream-file-button"><Upload size={16} /><span>{s('upload')}</span><input aria-label={s('upload')} type="file" accept=".mp4,.mov,.mkv,.webm,.avi,.m4v" onChange={(event) => { void uploadVideo(event.target.files?.[0]); event.target.value = ""; }} /></label>
              <button type="button" className="secondary danger" title={s('deleteVideo')} aria-label={s('deleteVideo')} disabled={!uploadId} onClick={async () => {
                if (!window.confirm(`${s('deleteConfirm')} ${upload?.name ?? ''}`)) return;
                try { await streamRequest(`/api/projects/${project.id}/stream-demo/uploads/${uploadId}`, { method: "DELETE" }); await refresh(); } catch (reason) { setError(String(reason)); }
              }}><Trash2 size={16} /></button></div>
            <small>{s('uploadHint')}</small>
            {upload && <small>{upload.width} × {upload.height} · {upload.fps} FPS · {upload.duration > 0 ? `${upload.duration.toFixed(1)} s` : s('unknownDuration')}{upload.duration_source === 'packets' ? ` · ${s('recovered')}` : ''}</small>}
          </> : <>
            <label>{s('camera')}<select aria-label={s('camera')} value={cameraId} onChange={(event) => setCameraId(event.target.value)}><option value="">{s('selectCamera')}</option>{caps?.cameras.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
            {!caps?.cameras.length && <p className="muted">{s('noCameras')}</p>}
            <label>{s('captureMode')}<select aria-label={s('captureMode')} value={cameraMode} onChange={(event) => setCameraMode(event.target.value)}><option value="">{s('selectCapture')}</option>{camera?.modes.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
            {camera?.error && <p className="review-error">{camera.error}</p>}
          </>}
        </fieldset>
        {progress !== null && <div className="stream-upload-progress" role="status"><progress aria-label={s('uploadProgress')} max={100} value={progress} /><span>{uploadName} · {progress === 100 ? s('checking') : `${s('uploading')} ${progress}%`}</span><button type="button" title={s('cancelUpload')} aria-label={s('cancelUpload')} onClick={() => uploadRef.current?.abort()}><Square size={16} /></button></div>}
        {uploadNotice && <p className="stream-upload-notice" role="status">{uploadNotice}</p>}
        {uploadError && <p className="review-error stream-upload-notice" role="alert">{uploadError}</p>}
        <details className="stream-output-settings"><summary>{s('output')} <small>{width} × {width*9/16} · {fps} FPS</small></summary><fieldset disabled={editingLocked || loading}><legend className="stream-sr-only">{s('output')}</legend><div className="stream-input-grid">
          <label>{s('resolution')}<select aria-label={s('resolution')} value={width} onChange={(e) => setWidth(Number(e.target.value))}>{[640, 960, 1280].map((value) => <option key={value} value={value}>{value} × {value * 9 / 16}</option>)}</select></label>
          <label>FPS<input aria-label="FPS" type="number" min={1} max={source === "camera" && mode ? Math.min(60, Math.floor(mode.fps)) : 60} value={fps} onChange={(e) => setFps(Number(e.target.value))} /></label>
          <label>{s('bitrate')}<input aria-label={s('bitrate')} type="number" min={100} max={20000} step={100} value={bitrate} onChange={(e) => setBitrate(Number(e.target.value))} /></label>
        </div></fieldset></details>
        <fieldset><legend>{s('inference')}</legend><div className="stream-input-grid">
          <label>{s('device')}<select aria-label={s('device')} disabled={editingLocked || selectedModel?.format !== "pt" || !caps?.cuda} value={effectiveDevice} onChange={(e) => setDevice(e.target.value)}><option value="cpu">CPU</option>{caps?.cuda && selectedModel?.format === "pt" && <option value="0">CUDA:0</option>}</select></label>
          <label>{s('imageSize')}<select aria-label={s('imageSize')} disabled={editingLocked || selectedModel?.format !== "pt"} value={selectedModel?.format !== "pt" ? "metadata" : imgsz} onChange={(e) => setImgsz(Number(e.target.value))}>{selectedModel?.format !== "pt" ? <option value="metadata">{s('metadata')}</option> : [320, 640, 960].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        </div>
          <StreamSwitch label={t('enable')} help={trackingVisualizationHelp(language,'compute')} language={language} checked={tracking} disabled={editingLocked} onChange={setTracking}/>
          <small className="muted">{t('detectionHint')}</small>
          <label className="stream-slider" htmlFor="stream-confidence">{s('confidence')}<output htmlFor="stream-confidence">{conf.toFixed(2)}</output><input id="stream-confidence" aria-label={s('confidence')} type="range" min={0} max={1} step={0.01} value={conf} onChange={(e) => setConf(Number(e.target.value))} /></label>
          <label className="stream-slider" htmlFor="stream-iou">IoU<output htmlFor="stream-iou">{postprocess === "NMS-free" || postprocess === "Embedded NMS" ? "N/A" : iou.toFixed(2)}</output><input id="stream-iou" aria-label="IoU" disabled={postprocess === "NMS-free" || postprocess === "Embedded NMS"} type="range" min={0} max={1} step={0.01} value={iou} onChange={(e) => setIou(Number(e.target.value))} /></label>
          <label className="stream-slider" htmlFor="stream-annotation-size">{t('annotationSize')}<output htmlFor="stream-annotation-size">{annotationSize} px</output><input id="stream-annotation-size" aria-label={t('annotationSize')} disabled={cliActive} type="range" min={8} max={24} step={1} value={annotationSize} onChange={e=>setAnnotationSize(Number(e.target.value))}/></label>
          {cliActive&&<small>{t('terminalSize')}</small>}
        </fieldset>

      </div>
      <div className="stream-monitor">
        <div className="stream-actions"><button type="button" className="primary" disabled={busy || invalidConfig} onClick={() => void start()}><Play size={17} />{s('start')}</button>
          <button type="button" className="secondary" disabled={!busy && !cliActive} onClick={stop}><Square size={17} />{s('stop')}</button></div>
        <div className="stream-video"><video ref={videoRef} muted playsInline aria-label={s('detectionStream')} style={{ visibility: cliActive ? "hidden" : "visible" }} />
          <StreamOpticalFlowOverlay video={videoRef} settings={flowSettings} active={!cliActive&&(state==='Live'||state==='Completed')} fps={fps} sessionKey={generation.current} resetKey={flowReset} onSummary={setFlowSummary}/>
          <StreamTrackingOverlay video={videoRef} frames={trackingFrames} selected={selectedTrack} onSelect={selectTrack} onTime={updateTime} viz={trackingViz} annotationSize={annotationSize} onStatus={setDisplayStatus} language={language} active={!cliActive && (state === "Live" || state === "Completed")} />
          {cliActive && cliFrame && <img className="stream-cli-frame" src={cliFrame} alt={s('terminalStream')} />}
          {cliActive && !cliFrame && <div className="stream-video-state"><Film size={36} /><span>{s('Terminal')}</span></div>}
          {state === "Idle" || state === "Ready" || state === "Stopped" || state === "Connecting" || state === "Failed" ? <div className="stream-video-state"><Film size={36} /><span>{s(state as StreamUiKey)}</span>{state === "Ready" && <small>{source === "upload" ? upload?.name : camera?.label}</small>}</div> : null}
        </div>
        {!cliActive && <div className="stream-playback">
          {source === "upload" ? <>
            <label htmlFor="stream-timeline">{s('playback')} · {(seekDraft ?? position).toFixed(1)} / {(upload?.duration ?? 0).toFixed(1)} s</label>
            <input id="stream-timeline" aria-label={s('timeline')} type="range" min={0} max={upload?.duration || 1} step={.1}
              disabled={!upload || upload.duration <= 0 || !selectedModel || selectedModel.available === false || !caps?.available || state === "Connecting" || loading}
              value={seekDraft ?? Math.min(position, upload?.duration ?? 0)}
              onChange={(event) => setSeekDraft(Number(event.target.value))}
              onPointerUp={(event) => seek(Number(event.currentTarget.value))}
              onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) seek(Number(event.currentTarget.value)); }} />
            <div className="stream-playback-actions">
              <button type="button" className="secondary" disabled={(state !== "Live" && state !== "Completed") || (paused&&invalidConfig)} onClick={togglePause}>{paused ? s('resume') : s('pause')}</button>
              <button type="button" className="secondary" disabled={!upload || !modelId || state === "Connecting" || loading} onClick={() => seek(0)}>{s('replay')}</button>
              <label>{s('time')}<input aria-label={s('playbackTime')} type="number" min={0} max={upload?.duration ?? 0} step={.1} value={jumpTime} onChange={(event) => setJumpTime(Number(event.target.value))} /></label>
              <button type="button" className="secondary" disabled={!upload || !modelId || !Number.isFinite(jumpTime) || jumpTime < 0 || jumpTime >= (upload?.duration ?? 0) || state === "Connecting" || loading} onClick={() => seek(jumpTime)}>{s('go')}</button>
            </div>
            <small>{t('seekReset')}</small>
            {paused&&<p className="muted" role="status">{t(pendingSettings?'pausedPending':'pausedEditing')}</p>}
          </> : <small>{s('liveHint')}</small>}
          {tracking && trackingViz.enabled && <div className="stream-target-actions"><span>{selectedTrack ? `${t('selected')} #${selectedTrack}` : t('selectHint')}</span><button type="button" className="secondary" disabled={!selectedTrack} onClick={() => selectTrack(null)}>{t('clear')}</button></div>}
        </div>}
        <div className="stream-monitor-bar"><span role="status">{paused&&(state==='Live'||state==='Completed')?t('pausedState'):s(state as StreamUiKey)}</span><span>{cliActive ? s('Terminal') : `${postprocess} · H.264 · ${bitrate} kbps`}</span><button type="button" className="secondary" title={s('fullscreen')} aria-label={s('fullscreen')} onClick={() => void videoRef.current?.parentElement?.requestFullscreen().catch((reason) => setError(String(reason)))}><Maximize size={16} /></button></div>
        {cliActive?<p className="stream-running-model">{t('terminalModel')}</p>:runningModel&&<p className="stream-running-model" aria-label={t('runningModel')}>{t('runningModel')}: {runningModel.format.toUpperCase()} · {runningModel.path}<br/><small>{runningModel.model_id}</small></p>}
        <dl className="stream-stats"><div><dt>{s('measuredFPS')}</dt><dd>{stats.fps}</dd></div><div><dt>{s('inference')}</dt><dd>{stats.inference_ms} ms</dd></div><div><dt>{s('detections')}</dt><dd>{stats.detections}{tracking && <small>{stats.tracks ?? 0} {t('confirmedTracks')} · {stats.untracked ?? 0} {t('detectedOnly')}</small>}</dd></div><div><dt>{s('frames')}</dt><dd>{stats.frames}</dd></div></dl>
        <TrackingSettingsPanel settings={trackingSettings} onChange={setTrackingSettings} onValidityChange={setTrackingValid} busy={editingLocked} viz={trackingViz} onViz={setTrackingViz} fps={fps} tracking={tracking} status={displayStatus} language={language}/>
        <OpticalFlowPanel settings={flowSettings} onChange={setFlowSettings} summary={flowSummary} onReset={()=>setFlowReset(n=>n+1)} terminal={cliActive} language={language}/>
        {modelMode === "conversion" && <details className="stream-code"><summary><Code size={17} />{s('cli')}</summary>
          <div className="stream-code-bar"><span>Python · utils · {selectedModel?.format.toUpperCase()}</span><button type="button" className="secondary" title={copied ? s('copied') : s('copy')} aria-label={s('copy')} disabled={!command} onClick={() => void copyCommand()}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
          <textarea ref={commandRef} aria-label={s('command')} readOnly rows={6} value={command} spellCheck={false} />
          {commandError && <p className="review-error" role="alert">{commandError}</p>}
        </details>}
      </div>
    </div>
    <Suspense fallback={<p role="status">{s('terminalLoading')}</p>}><CliWorkspace controlRef={cliControl} onDisplayRequest={prepareCliDisplay} onFrame={(url) => { if(!cliActiveRef.current)return;setCliFrame(url); if (!url) { cliActiveRef.current = false; setCliActive(false); setState("Stopped"); } }} /></Suspense>
  </section>;
}
