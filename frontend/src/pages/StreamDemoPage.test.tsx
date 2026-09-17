// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StreamDemoPage } from "./StreamDemoPage";
import * as api from "../api/streamDemo";

const player = { append: vi.fn(), end: vi.fn(), dispose: vi.fn() };
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
    if (path.endsWith("models")) return models as never;
    if (path.endsWith("verify-command")) return { command: "python -c 'print(123)'" } as never;
    return [{ id: "video", name: "clip.mp4", fps: 15, width: 640, height: 360, duration: 5 }] as never;
  });
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("selects a conversion before its format and uses CPU for exported artifacts", async () => {
  render(<StreamDemoPage project={project} />);
  await waitFor(() => expect((screen.getByLabelText("Model format") as HTMLSelectElement).value).toBe("pt1"));
  fireEvent.change(screen.getByLabelText("Model format"), { target: { value: "onnx1" } });
  expect((screen.getByLabelText("Device") as HTMLSelectElement).value).toBe("cpu");
  expect((screen.getByLabelText("Device") as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Conversion version"), { target: { value: "c2" } });
  expect((screen.getByLabelText("Model format") as HTMLSelectElement).value).toBe("tflite2");
  expect(screen.queryByRole("option", { name: "ONNX · ONNX Runtime" })).toBeNull();
});

it("sends selected model and live thresholds, and closes the stream on page exit", async () => {
  const view = render(<StreamDemoPage project={project} />);
  const start = screen.getByRole("button", { name: "Start" });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(start);
  const socket = FakeSocket.instance;
  socket.onopen?.();
  expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({ model_id: "pt1", source_id: "video", device: "0", fps: 15, bitrate: 2000 });
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
