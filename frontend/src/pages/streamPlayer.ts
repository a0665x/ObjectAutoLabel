export function createStreamPlayer(video: HTMLVideoElement, mime: string, onError: (message: string) => void) {
  if (typeof MediaSource === "undefined" || !MediaSource.isTypeSupported(mime)) {
    throw new Error("This browser cannot play H.264 streaming video. Use a current Chrome, Edge, or Safari browser.");
  }
  const media = new MediaSource();
  const url = URL.createObjectURL(media);
  const queue: ArrayBuffer[] = [];
  let buffer: SourceBuffer | undefined;
  let queuedBytes = 0;
  let ending = false;
  let disposed = false;
  video.src = url;
  function pump() {
    if (disposed || !buffer || buffer.updating || media.readyState !== "open") return;
    try {
      if (video.currentTime > 10 && buffer.buffered.length && buffer.buffered.start(0) < video.currentTime - 10) {
        buffer.remove(0, video.currentTime - 5);
        return;
      }
      const chunk = queue.shift();
      if (chunk) { queuedBytes -= chunk.byteLength; buffer.appendBuffer(chunk); }
      else if (ending) media.endOfStream();
      if (video.buffered.length) {
        const edge = video.buffered.end(video.buffered.length - 1);
        if (edge - video.currentTime > 1.5) video.currentTime = Math.max(0, edge - 0.3);
        if (video.paused) void video.play().catch(() => undefined);
      }
    } catch (error) { onError(error instanceof Error ? error.message : "Stream playback failed"); }
  }
  media.addEventListener("sourceopen", () => {
    if (disposed) return;
    try {
      buffer = media.addSourceBuffer(mime);
      buffer.addEventListener("updateend", pump);
      buffer.addEventListener("error", () => onError("H.264 stream decode failed"));
      pump();
    } catch (error) { onError(String(error)); }
  }, { once: true });
  return {
    append(chunk: ArrayBuffer) {
      if (disposed) return;
      queuedBytes += chunk.byteLength;
      if (queuedBytes > 16 * 1024 * 1024) { onError("Playback cannot keep up with the stream. Lower bitrate or FPS."); return; }
      queue.push(chunk);
      pump();
    },
    end() { ending = true; pump(); },
    dispose() {
      disposed = true;
      queue.length = 0;
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    }
  };
}
