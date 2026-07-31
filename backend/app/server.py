from __future__ import annotations

import os
import select
import socket
import socketserver
import threading

import uvicorn


APP_PORT = 8501


class _ProxyHandler(socketserver.BaseRequestHandler):
    target_host = "127.0.0.1"
    target_port = APP_PORT

    def handle(self) -> None:
        with socket.create_connection((self.target_host, self.target_port), timeout=10) as upstream:
            sockets = [self.request, upstream]
            while True:
                readable, _, _ = select.select(sockets, [], [], 30)
                if not readable:
                    return
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    destination = upstream if source is self.request else self.request
                    destination.sendall(data)


class _ThreadingTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def start_localhost_proxy(target_host: str) -> None:
    if target_host in {"127.0.0.1", "localhost", "0.0.0.0"}:
        return
    handler = type("LocalhostProxyHandler", (_ProxyHandler,), {"target_host": target_host})
    try:
        server = _ThreadingTCPServer(("127.0.0.1", APP_PORT), handler)
    except OSError as exc:
        print(f"Skipping localhost proxy on 127.0.0.1:{APP_PORT}: {exc}", flush=True)
        return
    thread = threading.Thread(target=server.serve_forever, name="localhost-proxy", daemon=True)
    thread.start()
    print(f"Forwarding http://127.0.0.1:{APP_PORT} -> http://{target_host}:{APP_PORT}", flush=True)


def main() -> None:
    bind_host = os.getenv("OBJECT_AUTOLABEL_BIND_HOST", "127.0.0.1")
    start_localhost_proxy(bind_host)
    uvicorn.run("backend.app.main:app", host=bind_host, port=APP_PORT)


if __name__ == "__main__":
    main()
