from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from fastapi import Request


def _enabled(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class AuthSettings:
    enabled: bool
    session_secret: str
    public_url: str | None
    google_client_id: str | None
    google_client_secret: str | None
    facebook_client_id: str | None
    facebook_client_secret: str | None
    line_client_id: str | None
    line_client_secret: str | None

    @classmethod
    def from_env(cls) -> "AuthSettings":
        value = lambda name: os.environ.get(name) or None
        return cls(
            enabled=_enabled(value("OBJECT_AUTOLABEL_AUTH_ENABLED")),
            session_secret=value("OBJECT_AUTOLABEL_SESSION_SECRET") or "",
            public_url=value("OBJECT_AUTOLABEL_PUBLIC_URL"),
            google_client_id=value("GOOGLE_CLIENT_ID"),
            google_client_secret=value("GOOGLE_CLIENT_SECRET"),
            facebook_client_id=value("FACEBOOK_CLIENT_ID"),
            facebook_client_secret=value("FACEBOOK_CLIENT_SECRET"),
            line_client_id=value("LINE_CLIENT_ID"),
            line_client_secret=value("LINE_CLIENT_SECRET"),
        )


class AuthService:
    """Small authentication interface hiding provider-specific OAuth behavior."""

    def __init__(self, settings: AuthSettings) -> None:
        self.settings = settings
        self.oauth: Any | None = None
        self._providers: list[str] = []
        if not settings.enabled:
            return
        if len(settings.session_secret) < 32:
            raise RuntimeError("OBJECT_AUTOLABEL_SESSION_SECRET must contain at least 32 characters when authentication is enabled")
        from authlib.integrations.starlette_client import OAuth

        self.oauth = OAuth()
        self._register_oidc("google", settings.google_client_id, settings.google_client_secret, "https://accounts.google.com/.well-known/openid-configuration")
        self._register_oauth(
            "facebook",
            settings.facebook_client_id,
            settings.facebook_client_secret,
            api_base_url="https://graph.facebook.com/",
            access_token_url="https://graph.facebook.com/oauth/access_token",
            authorize_url="https://www.facebook.com/dialog/oauth",
            scope="email public_profile",
        )
        self._register_oauth(
            "line",
            settings.line_client_id,
            settings.line_client_secret,
            api_base_url="https://api.line.me/oauth2/v2.1/",
            access_token_url="https://api.line.me/oauth2/v2.1/token",
            authorize_url="https://access.line.me/oauth2/v2.1/authorize",
            scope="profile openid",
        )

    @property
    def providers(self) -> list[str]:
        return list(self._providers)

    def _register_oidc(self, name: str, client_id: str | None, client_secret: str | None, metadata_url: str) -> None:
        if not client_id or not client_secret or self.oauth is None:
            return
        self.oauth.register(
            name,
            client_id=client_id,
            client_secret=client_secret,
            server_metadata_url=metadata_url,
            client_kwargs={"scope": "openid profile email"},
        )
        self._providers.append(name)

    def _register_oauth(self, name: str, client_id: str | None, client_secret: str | None, **config: Any) -> None:
        if not client_id or not client_secret or self.oauth is None:
            return
        scope = config.pop("scope")
        self.oauth.register(name, client_id=client_id, client_secret=client_secret, client_kwargs={"scope": scope}, **config)
        self._providers.append(name)

    def status(self, request: Request) -> dict[str, Any]:
        user = request.session.get("user") if self.settings.enabled else None
        return {
            "enabled": self.settings.enabled,
            "authenticated": not self.settings.enabled or bool(user),
            "providers": self.providers,
            "user": user,
        }

    def callback_url(self, request: Request, provider: str) -> str:
        path = f"/api/auth/callback/{provider}"
        if self.settings.public_url:
            return self.settings.public_url.rstrip("/") + path
        return str(request.url_for("complete_oauth_login", provider=provider))

    async def begin(self, request: Request, provider: str):
        client = self._client(provider)
        return await client.authorize_redirect(request, self.callback_url(request, provider))

    async def complete(self, request: Request, provider: str) -> dict[str, str | None]:
        client = self._client(provider)
        token = await client.authorize_access_token(request)
        if provider == "google":
            profile = dict(token.get("userinfo") or {})
        elif provider == "facebook":
            response = await client.get("me", token=token, params={"fields": "id,name,email,picture"})
            response.raise_for_status()
            profile = dict(response.json())
        else:
            response = await client.get("userinfo", token=token)
            response.raise_for_status()
            profile = dict(response.json())
        picture = profile.get("picture")
        if isinstance(picture, dict):
            picture = picture.get("data", {}).get("url")
        user = {
            "provider": provider,
            "subject": str(profile.get("sub") or profile.get("id") or profile.get("userId") or ""),
            "name": str(profile.get("name") or profile.get("displayName") or "User"),
            "email": str(profile.get("email")) if profile.get("email") else None,
            "picture": str(picture or profile.get("pictureUrl")) if picture or profile.get("pictureUrl") else None,
        }
        if not user["subject"]:
            raise RuntimeError(f"{provider} did not return a stable user identifier")
        request.session["user"] = user
        return user

    def logout(self, request: Request) -> None:
        request.session.clear()

    def _client(self, provider: str):
        if provider not in self._providers or self.oauth is None:
            raise KeyError(provider)
        client = self.oauth.create_client(provider)
        if client is None:
            raise KeyError(provider)
        return client
