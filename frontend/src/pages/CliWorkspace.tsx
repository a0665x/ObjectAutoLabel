import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Plus, X, TerminalSquare, RefreshCw } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

export type CliControl = { stopDisplay: () => Promise<void> };
type TerminalControl = { interrupt: () => Promise<void>; grant: (ticket: string) => void; session: string };
type Props = { controlRef: MutableRefObject<CliControl | null>; onDisplayRequest: () => Promise<void>; onFrame: (url: string) => void };

export function CliWorkspace({ controlRef, onDisplayRequest, onFrame }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [tabs, setTabs] = useState<number[]>([]);
  const [selected, setSelected] = useState(0);
  const [display, setDisplay] = useState<{ id: number; session: string }>();
  const next = useRef(1);
  const terminals = useRef(new Map<number, TerminalControl>());
  const owner = useRef<number | undefined>(undefined);
  const queue = useRef(Promise.resolve());
  const callbacks = useRef({ onDisplayRequest, onFrame });
  callbacks.current = { onDisplayRequest, onFrame };
  function serialize(fn: () => Promise<void>) {
    const result = queue.current.then(fn); queue.current = result.catch(() => {}); return result;
  }
  async function release() {
    if (owner.current !== undefined) await terminals.current.get(owner.current)?.interrupt();
    owner.current = undefined; setDisplay(undefined); callbacks.current.onFrame("");
  }
  useEffect(() => {
    controlRef.current = { stopDisplay: () => serialize(release) };
    return () => { controlRef.current = null; };
  }, [controlRef]);
  useEffect(() => {
    fetch("/api/cli/capabilities").then((r) => r.json()).then((r) => { setEnabled(r.enabled === true); if (r.enabled === true) add(); }).catch((e) => setError(String(e)));
  }, []);
  function add() { const id = next.current++; setTabs((values) => [...values, id]); setSelected(id); }
  async function requestDisplay(id: number, ticket: string) {
    try {
      await serialize(async () => {
        if (owner.current !== id) await release();
        await callbacks.current.onDisplayRequest();
        const terminal = terminals.current.get(id);
        if (!terminal) return;
        owner.current = id; setDisplay({ id, session: terminal.session }); terminal.grant(ticket);
      });
    } catch (reason) { setError(String(reason)); }
  }
  async function close(id: number) {
    try {
      await serialize(async () => { if (owner.current === id) await release(); });
      setTabs((values) => values.filter((value) => value !== id));
      if (selected === id) setSelected(tabs.find((value) => value !== id) ?? 0);
    } catch (reason) { setError(String(reason)); }
  }
  useEffect(() => {
    if (!display) return;
    let disposed = false;
    let currentUrl = "";
    let timer: number;
    const abort = new AbortController();
    async function update() {
      try {
        const response = await fetch(`/api/cli/preview?session=${display!.session}`, { signal: abort.signal });
        if (response.ok) {
          const blob = await response.blob();
          if (!disposed) {
            const url = URL.createObjectURL(blob); callbacks.current.onFrame(url);
            if (currentUrl) URL.revokeObjectURL(currentUrl);
            currentUrl = url;
          }
        }
      } catch (reason) { if (!disposed) setError(String(reason)); }
      finally { if (!disposed) timer = window.setTimeout(() => void update(), 100); }
    }
    void update();
    return () => { disposed = true; abort.abort(); window.clearTimeout(timer); if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, [display]);
  return <section className="cli-workspace" aria-label="Terminal workspace">
    <header className="cli-heading"><h3><TerminalSquare size={20} />Terminal</h3><code>/app/cli_workspace</code></header>
    {error && <p className="review-error" role="alert">{error}</p>}
    {!enabled ? <p role="status">CLI disabled. Set OBJECT_AUTOLABEL_CLI_ENABLED=true and recreate the service, then refresh this page.</p> : <>
      <div className="cli-tabs" role="tablist" aria-label="Terminals">
        {tabs.map((id) => <div className="cli-tab" key={id}><button type="button" role="tab" aria-selected={selected === id} aria-controls={`terminal-${id}`} onClick={() => setSelected(id)}>Terminal {id}</button><button type="button" title={`Close Terminal ${id}`} aria-label={`Close Terminal ${id}`} onClick={() => void close(id)}><X size={14} /></button></div>)}
        <button type="button" title="New terminal" aria-label="New terminal" disabled={tabs.length >= 6} onClick={add}><Plus size={17} /></button>
      </div>
      {tabs.map((id) => <TerminalSheet key={id} id={id} active={selected === id} register={(control) => { if (control) terminals.current.set(id, control); else terminals.current.delete(id); }} onRequest={(ticket) => void requestDisplay(id, ticket)} onError={setError} />)}
    </>}
  </section>;
}

function TerminalSheet({ id, active, register, onRequest, onError }: { id: number; active: boolean; register: (control?: TerminalControl) => void; onRequest: (ticket: string) => void; onError: (message: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const fitRef = useRef<(() => void) | undefined>(undefined);
  const callbacks = useRef({ register, onRequest, onError }); callbacks.current = { register, onRequest, onError };
  const [state, setState] = useState("Connecting");
  const [revision, setRevision] = useState(0);
  useEffect(() => { if (active) fitRef.current?.(); }, [active]);
  useEffect(() => {
    if (!element.current) return;
    let closed = false;
    let pending: { resolve: () => void; timer: number } | undefined;
    const term = new Terminal({ cursorBlink: true, fontSize: 13, scrollback: 2000, theme: { background: "#191b1e", foreground: "#e8eaed" } });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(element.current);
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/cli/terminal`);
    setState("Connecting");
    const send = (message: object) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); };
    const resize = () => { if (element.current?.offsetWidth) { fit.fit(); send({ type: "resize", rows: term.rows, cols: term.cols }); } };
    fitRef.current = () => { resize(); term.focus(); };
    const observer = new ResizeObserver(resize); observer.observe(element.current); resize();
    socket.onopen = () => send({});
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "started") {
        setState("Connected"); resize(); term.focus();
        callbacks.current.register({ session: message.session, grant: (ticket) => send({ type: "display_grant", ticket }), interrupt: () => new Promise<void>((resolve, reject) => {
          if (socket.readyState !== WebSocket.OPEN) { resolve(); return; }
          pending = { resolve, timer: window.setTimeout(() => { pending = undefined; reject(new Error("Terminal stop timed out")); }, 10000) };
          send({ type: "interrupt" });
        }) });
      }
      if (message.type === "interrupted" && pending) { window.clearTimeout(pending.timer); pending.resolve(); pending = undefined; }
      if (message.type === "display_request") callbacks.current.onRequest(message.ticket);
      if (message.type === "output") term.write(message.data);
      if (message.type === "error") { callbacks.current.onError(message.message); setState("Failed"); }
    };
    socket.onerror = () => { if (!closed) callbacks.current.onError("CLI terminal connection failed"); };
    socket.onclose = () => { callbacks.current.register(); if (pending) { window.clearTimeout(pending.timer); pending.resolve(); pending = undefined; } if (!closed) setState("Disconnected"); };
    const input = term.onData((data) => send({ type: "input", data }));
    return () => { closed = true; callbacks.current.register(); if (pending) { window.clearTimeout(pending.timer); pending.resolve(); } socket.close(); observer.disconnect(); input.dispose(); term.dispose(); fitRef.current = undefined; };
  }, [revision]);
  return <div role="tabpanel" id={`terminal-${id}`} aria-label={`Terminal ${id}`} hidden={!active}>
    <div className="cli-terminal-bar"><span role="status">{state}</span><button type="button" title="Reconnect terminal" aria-label="Reconnect terminal" disabled={state === "Connected" || state === "Connecting"} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={16} /></button></div>
    <div className="cli-terminal" ref={element} aria-label={`Docker terminal ${id}`} />
  </div>;
}
