from types import SimpleNamespace

import pytest

from backend.app.auth import AuthService, AuthSettings


def settings(**overrides):
    values = {
        "enabled": False,
        "session_secret": "",
        "public_url": None,
        "google_client_id": None,
        "google_client_secret": None,
        "facebook_client_id": None,
        "facebook_client_secret": None,
        "line_client_id": None,
        "line_client_secret": None,
    }
    values.update(overrides)
    return AuthSettings(**values)


def test_disabled_auth_preserves_trusted_local_mode() -> None:
    service = AuthService(settings())

    assert service.status(SimpleNamespace()) == {
        "enabled": False,
        "authenticated": True,
        "providers": [],
        "user": None,
    }


def test_enabled_auth_requires_a_strong_session_secret() -> None:
    with pytest.raises(RuntimeError, match="at least 32 characters"):
        AuthService(settings(enabled=True, session_secret="too-short"))


def test_only_fully_configured_oauth_providers_are_advertised() -> None:
    service = AuthService(
        settings(
            enabled=True,
            session_secret="a-secure-session-secret-with-32-chars",
            google_client_id="google-id",
            google_client_secret="google-secret",
            facebook_client_id="incomplete-facebook-id",
        )
    )

    assert service.providers == ["google"]
