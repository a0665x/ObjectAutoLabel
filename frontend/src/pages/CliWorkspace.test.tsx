// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CliWorkspace, type CliControl } from "./CliWorkspace";

vi.mock("@xterm/xterm", () => ({ Terminal: class { loadAddon() {} open() {} focus() {} write() {} dispose() {} onData() { return { dispose() {} }; } } }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn(); close = vi.fn();
  constructor() { Socket.instances.push(this); }
  message(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
beforeEach(() => {
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("capabilities")) return { ok: true, json: async () => ({ enabled: true }) };
    return { ok: false, status: 404, blob: async () => new Blob() };
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  const controlRef: { current: CliControl | null } = { current: null };
  const onDisplayRequest = vi.fn(async () => {}); const onFrame = vi.fn();
  const view = render(<CliWorkspace controlRef={controlRef} onDisplayRequest={onDisplayRequest} onFrame={onFrame} />);
  return { controlRef, onDisplayRequest, onFrame, view };
}
async function connect() {
  await screen.findByRole("tab", { name: "Terminal 1" });
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  act(() => Socket.instances[0].message({ type: "started", session: "one" }));
}
it("retains sessions while switching tabs and closes only the removed sheet", async () => {
  setup(); await connect();
  expect(screen.queryByText("Files")).toBeNull(); expect(screen.queryByText("Inference preview")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
  expect(Socket.instances).toHaveLength(2);
  fireEvent.click(screen.getByRole("tab", { name: "Terminal 1" }));
  expect(Socket.instances[1].close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close Terminal 2" }));
  await waitFor(() => expect(Socket.instances[1].close).toHaveBeenCalledOnce());
  expect(Socket.instances[0].close).not.toHaveBeenCalled();
});
it("grants display after the stream stops and waits for interrupt acknowledgment", async () => {
  const { controlRef, onDisplayRequest } = setup(); await connect();
  const socket = Socket.instances[0];
  act(() => socket.message({ type: "display_request", ticket: "ticket" }));
  await waitFor(() => expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "display_grant", ticket: "ticket" })));
  expect(onDisplayRequest).toHaveBeenCalledOnce();
  let done = false;
  let stopped: Promise<void>;
  act(() => { stopped = controlRef.current!.stopDisplay().then(() => { done = true; }); });
  await waitFor(() => expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "interrupt" })));
  expect(done).toBe(false);
  await act(async () => { socket.message({ type: "interrupted" }); await stopped; });
  expect(done).toBe(true);
});
it("shows setup guidance when the terminal is disabled", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ enabled: false }) })));
  setup();
  expect((await screen.findByRole("status")).textContent).toContain("OBJECT_AUTOLABEL_CLI_ENABLED=true");
  expect(Socket.instances).toHaveLength(0);
});
