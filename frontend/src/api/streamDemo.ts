export type StreamModel = { id: string; conversion_id: string; conversion_label: string; label: string; format: "pt" | "onnx" | "tflite"; layout?: "NCHW" | "NHWC"; input_shape?: number[] | null; available?: boolean; reason?: string | null };
export type StreamUpload = { id: string; name: string; width: number; height: number; fps: number; duration: number; bytes: number };
export type CameraMode = { id: string; label: string; fps: number };
export type StreamCapabilities = { available: boolean; missing_plugins: string[]; cameras: Array<{ id: string; label: string; modes: CameraMode[]; error?: string }>; cuda: boolean; mime: string; max_upload_bytes: number; engines: Record<StreamModel["format"], { available: boolean; device: string; reason?: string }> };

export async function streamRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Stream request failed");
  return body as T;
}

export function uploadStreamVideo(projectId: string, file: File, onProgress: (percent: number) => void, signal: AbortSignal): Promise<StreamUpload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${projectId}/stream-demo/uploads?filename=${encodeURIComponent(file.name)}`);
    xhr.timeout = 330000;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    const abort = () => xhr.abort();
    signal.addEventListener("abort", abort, { once: true });
    xhr.onloadend = () => signal.removeEventListener("abort", abort);
    xhr.onerror = () => reject(new Error("Video upload failed"));
    xhr.ontimeout = () => reject(new Error("Video upload timed out; check the connection and retry"));
    xhr.onabort = () => reject(new Error("Video upload cancelled"));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.detail || "Video upload failed"));
      } catch { reject(new Error(`Video upload failed (HTTP ${xhr.status}); the server did not return a valid response`)); }
    };
    if (signal.aborted) reject(new Error("Video upload cancelled"));
    else xhr.send(file);
  });
}
