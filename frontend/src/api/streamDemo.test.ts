// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { uploadStreamVideo } from "./streamDemo";

class FakeXHR {
  static instance: FakeXHR;
  timeout = 0;
  status = 201;
  responseText = "";
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null = null;
  onloadend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => { this.onabort?.(); this.onloadend?.(); });
  constructor() { FakeXHR.instance = this; }
}
afterEach(() => vi.unstubAllGlobals());

it("bounds upload waiting and returns an actionable timeout", async () => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  const promise = uploadStreamVideo("p1", new File(["video"], "clip.mp4"), vi.fn(), new AbortController().signal);
  const failed = expect(promise).rejects.toThrow("Video upload timed out");
  expect(FakeXHR.instance.timeout).toBe(330000);
  FakeXHR.instance.ontimeout?.();
  await failed;
});

it("reports progress, parses successful uploads, and preserves proxy error status", async () => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  const progress = vi.fn();
  const promise = uploadStreamVideo("p1", new File(["video"], "clip.mp4"), progress, new AbortController().signal);
  FakeXHR.instance.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
  expect(progress).toHaveBeenCalledWith(50);
  FakeXHR.instance.responseText = JSON.stringify({ id: "video" });
  FakeXHR.instance.onload?.();
  await expect(promise).resolves.toEqual({ id: "video" });
  const error = uploadStreamVideo("p1", new File(["video"], "clip.mp4"), progress, new AbortController().signal);
  const failed = expect(error).rejects.toThrow("HTTP 413");
  FakeXHR.instance.status = 413;
  FakeXHR.instance.responseText = "<html>Too large</html>";
  FakeXHR.instance.onload?.();
  await failed;
});

it("cancels an in-flight upload and does not send an already cancelled upload", async () => {
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  const controller = new AbortController();
  const promise = uploadStreamVideo("p1", new File(["video"], "clip.mp4"), vi.fn(), controller.signal);
  const failed = expect(promise).rejects.toThrow("cancelled");
  controller.abort();
  await failed;
  expect(FakeXHR.instance.abort).toHaveBeenCalledOnce();
  await expect(uploadStreamVideo("p1", new File(["video"], "clip.mp4"), vi.fn(), controller.signal)).rejects.toThrow("cancelled");
  expect(FakeXHR.instance.send).not.toHaveBeenCalled();
});
