import socket

from backend.app import server


class ProbeSocket:
    def __init__(self, family: int, bound: list[tuple[int, tuple[str, int]]], error: OSError | None = None) -> None:
        self.family = family
        self.bound = bound
        self.error = error

    def __enter__(self) -> "ProbeSocket":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def bind(self, address: tuple[str, int]) -> None:
        if self.error:
            raise self.error
        self.bound.append((self.family, address))


def install_probe(monkeypatch, error: OSError | None = None) -> list[tuple[int, tuple[str, int]]]:
    bound: list[tuple[int, tuple[str, int]]] = []
    monkeypatch.setattr(
        server.socket,
        "socket",
        lambda family, _kind: ProbeSocket(family, bound, error),
    )
    return bound


def test_resolve_bind_host_preserves_loopback_ipv4() -> None:
    assert server.resolve_bind_host("127.0.0.1") == "127.0.0.1"


def test_resolve_bind_host_preserves_available_ipv4(monkeypatch) -> None:
    bound = install_probe(monkeypatch)

    assert server.resolve_bind_host("10.0.0.7") == "10.0.0.7"
    assert bound == [(socket.AF_INET, ("10.0.0.7", 0))]


def test_resolve_bind_host_preserves_loopback_ipv6(monkeypatch) -> None:
    bound = install_probe(monkeypatch)

    assert server.resolve_bind_host("::1") == "::1"
    assert bound == [(socket.AF_INET6, ("::1", 0))]


def test_resolve_bind_host_falls_back_when_configured_ipv4_is_not_local(monkeypatch) -> None:
    install_probe(monkeypatch, OSError("not assigned"))

    assert server.resolve_bind_host("192.0.2.1") == "127.0.0.1"


def test_start_localhost_proxy_forwards_to_ipv6_loopback(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeServer:
        def __init__(self, address, handler) -> None:
            captured["address"] = address
            captured["handler"] = handler

        def serve_forever(self) -> None:
            return None

    class FakeThread:
        def __init__(self, *, target, name, daemon) -> None:
            captured["target"] = target
            captured["name"] = name
            captured["daemon"] = daemon

        def start(self) -> None:
            captured["started"] = True

    monkeypatch.setattr(server, "_ThreadingTCPServer", FakeServer)
    monkeypatch.setattr(server.threading, "Thread", FakeThread)

    server.start_localhost_proxy("::1")

    assert captured["address"] == ("127.0.0.1", server.APP_PORT)
    assert captured["handler"].target_host == "::1"
    assert captured["started"] is True
