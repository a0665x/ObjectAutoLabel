import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Film, Play, Square, RefreshCw, Upload, Trash2, Maximize, Camera, Copy, Check, Code } from "lucide-react";
import type { Project } from "../types";
import { streamRequest, uploadStreamVideo, type StreamCapabilities, type StreamModel, type StreamUpload } from "../api/streamDemo";
import { createStreamPlayer } from "./streamPlayer";
import type { CliControl } from "./CliWorkspace";
const CliWorkspace = lazy(() => import("./CliWorkspace").then((module) => ({ default: module.CliWorkspace })));

export function StreamDemoPage({ project }: { project: Project }) {
  const cliControl = useRef<CliControl | null>(null);
  const [cliFrame, setCliFrame] = useState("");
  const [cliActive, setCliActive] = useState(false);
  const cliActiveRef = useRef(false);
  const starting = useRef(false);
  const [caps, setCaps] = useState<StreamCapabilities>();
  const [models, setModels] = useState<StreamModel[]>([]);
  const [uploads, setUploads] = useState<StreamUpload[]>([]);
  const [conversionId, setConversionId] = useState("");
  const [modelId, setModelId] = useState("");
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
  const [state, setState] = useState("Idle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadNotice, setUploadNotice] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [stats, setStats] = useState({ fps: 0, inference_ms: 0, frames: 0, detections: 0 });
  const [postprocess, setPostprocess] = useState("Auto");
  const [command, setCommand] = useState("");
  const [commandError, setCommandError] = useState("");
  const [copied, setCopied] = useState(false);
  const commandRef = useRef<HTMLTextAreaElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<ReturnType<typeof createStreamPlayer> | null>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const busy = state === "Connecting" || state === "Live";
  const selectedModel = models.find((model) => model.id === modelId);
  const camera = caps?.cameras.find((item) => item.id === cameraId);
  const mode = camera?.modes.find((item) => item.id === cameraMode);
  const upload = uploads.find((item) => item.id === uploadId);
  const engine = selectedModel && caps?.engines[selectedModel.format];
  const conversions = Array.from(new Map(models.map((model) => [model.conversion_id, model.conversion_label])));
  const effectiveDevice = selectedModel?.format === "pt" && caps?.cuda ? device : "cpu";

  function dispose() {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) { socket.onclose = null; socket.onmessage = null; socket.onerror = null; socket.onopen = null; socket.close(); }
    playerRef.current?.dispose();
    playerRef.current = null;
  }
  function stop() {
    dispose();
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

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [nextCaps, nextModels, nextUploads] = await Promise.all([
        streamRequest<StreamCapabilities>("/api/stream-demo/capabilities"),
        streamRequest<StreamModel[]>(`/api/projects/${project.id}/stream-demo/models`),
        streamRequest<StreamUpload[]>(`/api/projects/${project.id}/stream-demo/uploads`)
      ]);
      setCaps(nextCaps); setModels(nextModels); setUploads(nextUploads);
      const usable = nextModels.filter((model) => model.available !== false);
      setConversionId((value) => nextModels.some((m) => m.conversion_id === value) ? value : usable[0]?.conversion_id ?? nextModels[0]?.conversion_id ?? "");
      setModelId((value) => nextModels.some((m) => m.id === value && m.available !== false) ? value : usable[0]?.id ?? nextModels[0]?.id ?? "");
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
  useEffect(() => { if (mode) setFps((value) => Math.max(1, Math.min(value, Math.floor(mode.fps)))); }, [cameraMode]);
  useEffect(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ thresholds: { conf, iou } }));
  }, [conf, iou]);
  useEffect(() => { setPostprocess("Auto"); }, [modelId]);
  useEffect(() => {
    if (cliActiveRef.current) return;
    dispose();
    setState((source === "upload" ? uploadId : cameraMode) ? "Ready" : "Idle");
    setStats({ fps: 0, inference_ms: 0, frames: 0, detections: 0 });
  }, [source, uploadId, cameraMode, modelId]);
  useEffect(() => {
    setCommand(""); setCommandError(""); setCopied(false);
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

  async function start() {
    if (starting.current || !caps || !videoRef.current || !selectedModel) return;
    starting.current = true;
    setState("Connecting");
    try { if (cliControl.current) await cliControl.current.stopDisplay(); }
    catch (reason) { starting.current = false; setState("Failed"); setError(String(reason)); return; }
    cliActiveRef.current = false; setCliActive(false); setCliFrame("");
    dispose(); setError(""); setState("Connecting"); setPostprocess("Auto"); setStats({ fps: 0, inference_ms: 0, frames: 0, detections: 0 });
    try {
      playerRef.current = createStreamPlayer(videoRef.current, caps.mime, fail);
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/projects/${project.id}/stream-demo/live`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      let ended = false;
      socket.onopen = () => socket.send(JSON.stringify({ model_id: modelId, source, source_id: source === "upload" ? uploadId : cameraId,
        camera_mode: cameraMode, width, fps, bitrate, conf, iou, imgsz, device: effectiveDevice }));
      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) { playerRef.current?.append(event.data); return; }
        const message = JSON.parse(event.data);
        if (message.postprocess) setPostprocess(message.postprocess);
        if (message.type === "started") setState("Live");
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

  async function uploadVideo(file?: File) {
    if (!file) return;
    setUploadNotice(""); setUploadError(""); setUploadName(file.name);
    if (!caps) { setUploadError("Video services are still loading"); return; }
    if (!/\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file.name)) { setUploadError("Select an MP4, MOV, MKV, WebM, AVI, or M4V video file"); return; }
    if (!file.size) { setUploadError("The selected video file is empty"); return; }
    if (file.size > caps.max_upload_bytes) { setUploadError("Video exceeds the 1 GiB upload limit"); return; }
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
      <button type="button" className="secondary" title="Refresh models and cameras" aria-label="Refresh models and cameras" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={17} /></button>
    </header>
    {error && <p className="review-error" role="alert">{error}</p>}
    {caps && !caps.available && <p className="review-error" role="alert">GStreamer unavailable: {caps.missing_plugins.join(", ")}</p>}
    <div className="stream-models">
      <label>Conversion version<select aria-label="Conversion version" value={conversionId} disabled={busy || loading} onChange={(event) => {
        const id = event.target.value; setConversionId(id); setModelId(models.find((m) => m.conversion_id === id && m.available !== false)?.id ?? models.find((m) => m.conversion_id === id)?.id ?? "");
      }}><option value="" disabled>{loading ? "Loading..." : "Select conversion"}</option>{conversions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Model format<select aria-label="Model format" value={modelId} disabled={busy || loading} onChange={(event) => setModelId(event.target.value)}>
        <option value="" disabled>Select model format</option>{models.filter((m) => m.conversion_id === conversionId).map((model) => { const unavailable = model.available === false || !caps?.engines[model.format].available; return <option key={model.id} value={model.id} disabled={unavailable}>{model.label}{unavailable ? ` · ${model.reason ?? caps?.engines[model.format].reason ?? "Unavailable"}` : ""}</option>; })}
      </select></label>
    </div>
    {selectedModel && <p className="stream-lineage">{selectedModel.conversion_label}</p>}
    {!loading && !models.length && <p className="muted">No completed conversion models in this project.</p>}
    {selectedModel?.available === false && <p className="review-error">Model unavailable: {selectedModel.reason}</p>}
    <div className="stream-layout">
      <div className="stream-settings">
        <fieldset disabled={busy || loading || progress !== null}><legend>Source</legend>
          <div className="stream-source-switch"><label><input type="radio" name="stream-source" checked={source === "upload"} onChange={() => setSource("upload")} /><Film size={16} />Video file</label><label><input type="radio" name="stream-source" checked={source === "camera"} onChange={() => setSource("camera")} /><Camera size={16} />Host camera</label></div>
          {source === "upload" ? <>
            <label>Video<select aria-label="Video" value={uploadId} onChange={(event) => setUploadId(event.target.value)}><option value="">Select video</option>{uploads.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <div className="stream-upload-actions"><label className="stream-file-button"><Upload size={16} /><span>Upload video</span><input aria-label="Upload video" type="file" accept=".mp4,.mov,.mkv,.webm,.avi,.m4v" onChange={(event) => { void uploadVideo(event.target.files?.[0]); event.target.value = ""; }} /></label>
              <button type="button" className="secondary danger" title="Delete uploaded video" aria-label="Delete uploaded video" disabled={!uploadId} onClick={async () => {
                if (!window.confirm(`Delete ${upload?.name ?? "video"}?`)) return;
                try { await streamRequest(`/api/projects/${project.id}/stream-demo/uploads/${uploadId}`, { method: "DELETE" }); await refresh(); } catch (reason) { setError(String(reason)); }
              }}><Trash2 size={16} /></button></div>
            {upload && <small>{upload.width} × {upload.height} · {upload.fps} FPS · {upload.duration.toFixed(1)} s</small>}
          </> : <>
            <label>Camera<select aria-label="Camera" value={cameraId} onChange={(event) => setCameraId(event.target.value)}><option value="">Select camera</option>{caps?.cameras.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
            {!caps?.cameras.length && <p className="muted">No host cameras detected.</p>}
            <label>Capture mode<select aria-label="Capture mode" value={cameraMode} onChange={(event) => setCameraMode(event.target.value)}><option value="">Select capture mode</option>{camera?.modes.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
            {camera?.error && <p className="review-error">{camera.error}</p>}
          </>}
        </fieldset>
        {progress !== null && <div className="stream-upload-progress" role="status"><progress aria-label="Video upload progress" max={100} value={progress} /><span>{uploadName} · {progress === 100 ? "Checking video..." : `Uploading ${progress}%`}</span><button type="button" title="Cancel upload" aria-label="Cancel upload" onClick={() => uploadRef.current?.abort()}><Square size={16} /></button></div>}
        {uploadNotice && <p className="stream-upload-notice" role="status">{uploadNotice}</p>}
        {uploadError && <p className="review-error stream-upload-notice" role="alert">{uploadError}</p>}
        <fieldset disabled={busy || loading}><legend>Video output</legend><div className="stream-input-grid">
          <label>Resolution<select aria-label="Resolution" value={width} onChange={(e) => setWidth(Number(e.target.value))}>{[640, 960, 1280].map((value) => <option key={value} value={value}>{value} × {value * 9 / 16}</option>)}</select></label>
          <label>FPS<input aria-label="FPS" type="number" min={1} max={source === "camera" && mode ? Math.min(60, Math.floor(mode.fps)) : 60} value={fps} onChange={(e) => setFps(Number(e.target.value))} /></label>
          <label>Bitrate (kbps)<input aria-label="Bitrate (kbps)" type="number" min={100} max={20000} step={100} value={bitrate} onChange={(e) => setBitrate(Number(e.target.value))} /></label>
        </div></fieldset>
        <fieldset><legend>Inference</legend><div className="stream-input-grid">
          <label>Device<select aria-label="Device" disabled={busy || selectedModel?.format !== "pt" || !caps?.cuda} value={effectiveDevice} onChange={(e) => setDevice(e.target.value)}><option value="cpu">CPU</option>{caps?.cuda && selectedModel?.format === "pt" && <option value="0">CUDA:0</option>}</select></label>
          <label>Image size<select aria-label="Image size" disabled={busy || selectedModel?.format !== "pt"} value={selectedModel?.format !== "pt" ? "metadata" : imgsz} onChange={(e) => setImgsz(Number(e.target.value))}>{selectedModel?.format !== "pt" ? <option value="metadata">Export metadata</option> : [320, 640, 960].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        </div>
          <label className="stream-slider" htmlFor="stream-confidence">Confidence<output htmlFor="stream-confidence">{conf.toFixed(2)}</output><input id="stream-confidence" aria-label="Confidence" type="range" min={0} max={1} step={0.01} value={conf} onChange={(e) => setConf(Number(e.target.value))} /></label>
          <label className="stream-slider" htmlFor="stream-iou">IoU<output htmlFor="stream-iou">{postprocess === "NMS-free" || postprocess === "Embedded NMS" ? "N/A" : iou.toFixed(2)}</output><input id="stream-iou" aria-label="IoU" disabled={postprocess === "NMS-free" || postprocess === "Embedded NMS"} type="range" min={0} max={1} step={0.01} value={iou} onChange={(e) => setIou(Number(e.target.value))} /></label>
        </fieldset>
        <div className="stream-actions"><button type="button" className="primary" disabled={busy || loading || progress !== null || !caps?.available || selectedModel?.available === false || !engine?.available || !modelId || (source === "upload" ? !uploadId : !cameraMode) || fps < 1 || fps > 60 || bitrate < 100 || bitrate > 20000} onClick={start}><Play size={17} />Start</button>
          <button type="button" className="secondary" disabled={!busy && !cliActive} onClick={stop}><Square size={17} />Stop</button></div>
      </div>
      <div className="stream-monitor">
        <div className="stream-video"><video ref={videoRef} muted autoPlay playsInline controls aria-label="Detection stream" style={{ visibility: cliActive ? "hidden" : "visible" }} />
          {cliActive && cliFrame && <img className="stream-cli-frame" src={cliFrame} alt="Terminal detection stream" />}
          {cliActive && !cliFrame && <div className="stream-video-state"><Film size={36} /><span>Terminal</span></div>}
          {state === "Idle" || state === "Ready" || state === "Stopped" || state === "Connecting" || state === "Failed" ? <div className="stream-video-state"><Film size={36} /><span>{state}</span>{state === "Ready" && <small>{source === "upload" ? upload?.name : camera?.label}</small>}</div> : null}
        </div>
        <div className="stream-monitor-bar"><span role="status">{state}</span><span>{cliActive ? "Terminal" : `${postprocess} · H.264 · ${bitrate} kbps`}</span><button type="button" className="secondary" title="Fullscreen" aria-label="Fullscreen" onClick={() => void videoRef.current?.parentElement?.requestFullscreen().catch((reason) => setError(String(reason)))}><Maximize size={16} /></button></div>
        <dl className="stream-stats"><div><dt>Measured FPS</dt><dd>{stats.fps}</dd></div><div><dt>Inference</dt><dd>{stats.inference_ms} ms</dd></div><div><dt>Detections</dt><dd>{stats.detections}</dd></div><div><dt>Frames</dt><dd>{stats.frames}</dd></div></dl>
        <details className="stream-code" open><summary><Code size={17} />CLI verification</summary>
          <div className="stream-code-bar"><span>Python · utils · {selectedModel?.format.toUpperCase()}</span><button type="button" className="secondary" title={copied ? "Copied" : "Copy Python command"} aria-label="Copy Python command" disabled={!command} onClick={() => void copyCommand()}>{copied ? <Check size={16} /> : <Copy size={16} />}</button></div>
          <textarea ref={commandRef} aria-label="Python verification command" readOnly rows={6} value={command} spellCheck={false} />
          {commandError && <p className="review-error" role="alert">{commandError}</p>}
        </details>
      </div>
    </div>
    <Suspense fallback={<p role="status">Loading terminal...</p>}><CliWorkspace controlRef={cliControl} onDisplayRequest={prepareCliDisplay} onFrame={(url) => { setCliFrame(url); if (!url) { cliActiveRef.current = false; setCliActive(false); setState("Stopped"); } }} /></Suspense>
  </section>;
}
