"""hermes-bridge platform adapter (Hermes plugin).

Ships as a Hermes "platform" plugin (same extension point as the bundled
teams/discord/ntfy adapters). Installed at runtime into
``/opt/data/.hermes/plugins/hermes-bridge/`` by ``npx @aidalinfo/hermes-bridge
install`` — no Hermes image rebuild required.

Opens an outbound WebSocket connection to the hermes-bridge relay (the bot
always dials out; the relay never needs network access into the bot's host).
On each incoming wake message, injects a MessageEvent into the gateway
pipeline, which triggers a normal inference turn. The agent answers via the
relay's `reply` MCP tool — this adapter never sends content itself.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, Optional

try:
    import websockets

    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False
    websockets = None  # type: ignore[assignment]

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import (
    BasePlatformAdapter,
    MessageEvent,
    MessageType,
    SendResult,
    merge_pending_message_event,
)
from gateway.session import build_session_key

from .wake import build_wake_text, parse_wake_payload, session_chat_id

logger = logging.getLogger(__name__)

RECONNECT_BACKOFF = [2, 5, 10, 30, 60]


def check_requirements() -> bool:
    """Check whether the adapter is installable and minimally configured."""
    if not WEBSOCKETS_AVAILABLE:
        logger.warning("[hermes-bridge] websockets is not installed — pip install websockets")
        return False
    return bool(os.getenv("HERMES_BRIDGE_TOKEN") and os.getenv("HERMES_BRIDGE_RELAY_URL"))


class HermesBridgeAdapter(BasePlatformAdapter):
    """Outbound WebSocket client to the hermes-bridge relay."""

    def __init__(self, config: PlatformConfig):
        super().__init__(config, Platform("hermes-bridge"))
        extra = config.extra or {}
        self._relay_url: str = extra.get("relay_url") or os.environ["HERMES_BRIDGE_RELAY_URL"]
        self._token: str = extra.get("token") or os.environ["HERMES_BRIDGE_TOKEN"]
        self._ws = None
        self._task: Optional[asyncio.Task] = None
        self._running = True

    async def connect(self) -> bool:
        self._task = asyncio.create_task(self._run())
        self._mark_connected()
        return True

    async def disconnect(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
        if self._ws is not None:
            await self._ws.close()
        self._mark_disconnected()

    async def _run(self) -> None:
        backoff_idx = 0
        while self._running:
            try:
                async with websockets.connect(
                    self._relay_url,
                    additional_headers={"Authorization": f"Bearer {self._token}"},
                ) as ws:
                    self._ws = ws
                    backoff_idx = 0
                    async for raw in ws:
                        await self._on_wake(raw)
            except asyncio.CancelledError:
                return
            except Exception:
                logger.exception("[hermes-bridge] connection error")
            self._ws = None
            if not self._running:
                return
            delay = RECONNECT_BACKOFF[min(backoff_idx, len(RECONNECT_BACKOFF) - 1)]
            await asyncio.sleep(delay)
            backoff_idx += 1

    async def _on_wake(self, raw: str) -> None:
        try:
            payload = parse_wake_payload(raw)
        except ValueError:
            logger.warning("[hermes-bridge] dropping invalid wake payload")
            return

        chat_id = session_chat_id(payload["conversation_id"])
        source = self.build_source(
            chat_id=chat_id,
            chat_name=f"hermes-bridge:{payload['from']}",
            chat_type="dm",
            user_id=payload["from"],
            user_name=payload["from"],
        )
        event = MessageEvent(
            text=build_wake_text(payload),
            message_type=MessageType.TEXT,
            source=source,
            message_id=payload["request_id"],
            raw_message=payload,
            internal=True,
        )
        await self.handle_message(event)

    async def handle_message(self, event: MessageEvent) -> None:
        """Queue wakes that arrive while the target session is mid-turn.

        Mirrors the pattern used by Hermes' bundled `raft` adapter: a wake
        received while the bot is busy answering a previous hermes-bridge
        request is merged into the pending queue rather than dropped or
        injected mid-turn (see the design spec's "no nested clarification"
        limitation).
        """
        session_key = build_session_key(
            event.source, group_sessions_per_user=True, thread_sessions_per_user=False
        )
        if session_key in self._active_sessions:
            merge_pending_message_event(self._pending_messages, session_key, event)
            return
        await super().handle_message(event)

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        # hermes-bridge delivers answers via the `reply` MCP tool, not via
        # adapter.send — this is a no-op, like RaftAdapter.send.
        return SendResult(success=True)

    async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:
        return {"name": chat_id, "type": "hermes-bridge"}


def register(ctx) -> None:
    """Plugin entry point — called by the Hermes plugin loader at startup."""
    ctx.register_platform(
        name="hermes-bridge",
        label="Hermes Bridge",
        adapter_factory=lambda cfg: HermesBridgeAdapter(cfg),
        check_fn=check_requirements,
        required_env=["HERMES_BRIDGE_TOKEN", "HERMES_BRIDGE_RELAY_URL"],
        install_hint="npx @aidalinfo/hermes-bridge install --token=... --relay-url=...",
        emoji="🌉",
        platform_hint=(
            "Tu es connecté à un autre agent Hermes via hermes-bridge. "
            "Réponds aux demandes en attente avec le tool reply(request_id, answer). "
            "Pour poser une question ou déléguer une tâche à un autre agent, utilise "
            "ask_agent(to, message, conversation_id) — réutilise conversation_id pour "
            "poursuivre un échange déjà ouvert."
        ),
    )
