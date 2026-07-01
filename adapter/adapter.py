"""hermes-bridge platform adapter (Hermes plugin).

Ships as a Hermes "platform" plugin (same extension point as the bundled
teams/discord/ntfy adapters). Installed at runtime into
``/opt/data/plugins/hermes-bridge/`` by ``npx @aidalinfo/hermes-bridge
install`` — no Hermes image rebuild required.

Opens an outbound WebSocket connection to the hermes-bridge relay (the bot
always dials out; the relay never needs network access into the bot's host).
On each incoming wake message, injects a MessageEvent into the gateway
pipeline, which triggers a normal inference turn. The agent answers via the
relay's `reply` MCP tool — this adapter never sends content itself.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
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

from .wake import (
    build_wake_text,
    extract_request_id,
    parse_wake_payload,
    platform_value,
    session_chat_id,
)

logger = logging.getLogger(__name__)

RECONNECT_BACKOFF = [2, 5, 10, 30, 60]

# Minimum spacing between heartbeat frames for the same session — a tool-call
# loop can fire post_tool_call several times a second; the relay only needs
# to know "still alive" roughly as often as its timeout window, not on every
# iteration.
HEARTBEAT_MIN_INTERVAL_S = 5.0

# Hermes' hooks pass `session_id=agent.session_id` — an identifier generated
# fresh per agent run (agent_init.py: f"{timestamp}_{short_uuid}"). It has no
# relation to `build_session_key()` (that's a routing/continuity key, used
# for message-queuing, not exposed to hooks at all). So the request_id this
# turn is answering can't be *computed* in advance from the wake — it has to
# be *read back* out of what Hermes hands the hook. `pre_llm_call` is the
# first hook that gives us both `session_id` and `user_message`, and our own
# wake.build_wake_text() embeds "request_id=<id>" in that exact text — so we
# parse it back out (wake.extract_request_id) and bind session_id ->
# request_id right there. Every later post_tool_call/post_llm_call in the
# same run just reuses the binding.

# Hooks are module-level callbacks with no reference to the adapter instance
# that registered them — same pattern as the bundled `raft` adapter. There
# is only ever one hermes-bridge adapter per gateway process (one outbound
# relay connection), so a single slot is enough; no need for raft's
# multi-adapter set.
_ACTIVE_ADAPTER_LOCK = threading.Lock()
_ACTIVE_ADAPTER: Optional["HermesBridgeAdapter"] = None


def _get_active_adapter() -> Optional["HermesBridgeAdapter"]:
    with _ACTIVE_ADAPTER_LOCK:
        return _ACTIVE_ADAPTER


def _on_pre_llm_call(**kwargs: Any) -> None:
    adapter = _get_active_adapter()
    if adapter is None:
        return
    session_id = kwargs.get("session_id")
    if platform_value(kwargs.get("platform")) == "hermes-bridge":
        request_id = extract_request_id(kwargs.get("user_message") or "")
        if request_id:
            adapter.bind_session(session_id, request_id)
    adapter.note_activity(session_id)


def _on_post_tool_call(**kwargs: Any) -> None:
    adapter = _get_active_adapter()
    if adapter is not None:
        adapter.note_activity(kwargs.get("session_id"))


def _on_post_llm_call(**kwargs: Any) -> None:
    adapter = _get_active_adapter()
    if adapter is not None:
        adapter.note_activity(kwargs.get("session_id"))


def _on_session_end(**kwargs: Any) -> None:
    adapter = _get_active_adapter()
    if adapter is not None:
        adapter.forget_session(kwargs.get("session_id"))


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
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        # agent.session_id -> request_id, bound by _on_pre_llm_call (see
        # module level) the moment a hermes-bridge turn starts, so later
        # post_tool_call/post_llm_call hooks in the same run know which
        # pending relay request to keep alive.
        self._session_requests: Dict[str, str] = {}
        self._last_heartbeat: Dict[str, float] = {}
        self._heartbeat_lock = threading.Lock()

    async def connect(self) -> bool:
        self._loop = asyncio.get_running_loop()
        self._task = asyncio.create_task(self._run())
        self._mark_connected()
        global _ACTIVE_ADAPTER
        with _ACTIVE_ADAPTER_LOCK:
            _ACTIVE_ADAPTER = self
        return True

    async def disconnect(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
        if self._ws is not None:
            await self._ws.close()
        global _ACTIVE_ADAPTER
        with _ACTIVE_ADAPTER_LOCK:
            if _ACTIVE_ADAPTER is self:
                _ACTIVE_ADAPTER = None
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

    def bind_session(self, session_id: Optional[str], request_id: str) -> None:
        """Record that *session_id* (a live agent run) is answering *request_id*.

        Called from _on_pre_llm_call once it's parsed the request_id back out
        of the wake text Hermes handed it — see the module-level comment on
        _REQUEST_ID_IN_TEXT_RE for why this can't just be precomputed in
        _on_wake.
        """
        if not session_id:
            return
        with self._heartbeat_lock:
            self._session_requests[session_id] = request_id

    def note_activity(self, session_id: Optional[str]) -> None:
        """Called from a plugin hook (any thread) on genuine turn activity.

        If *session_id* is bound to a pending hermes-bridge request (see
        bind_session), tell the relay to push out that request's deadline —
        this is what lets a slow multi-tool-call answer survive past a fixed
        `ask_timeout_ms` without having to guess a bigger number: the timeout
        only matters once the agent has gone quiet, not while it's
        demonstrably still working.
        """
        if not session_id or self._loop is None:
            return
        now = time.monotonic()
        with self._heartbeat_lock:
            request_id = self._session_requests.get(session_id)
            if request_id is None:
                return
            if now - self._last_heartbeat.get(session_id, 0.0) < HEARTBEAT_MIN_INTERVAL_S:
                return
            self._last_heartbeat[session_id] = now
        asyncio.run_coroutine_threadsafe(self._send_heartbeat(request_id), self._loop)

    def forget_session(self, session_id: Optional[str]) -> None:
        """Stop tracking a session once its turn ends (hook: on_session_end)."""
        if not session_id:
            return
        with self._heartbeat_lock:
            self._session_requests.pop(session_id, None)
            self._last_heartbeat.pop(session_id, None)

    async def _send_heartbeat(self, request_id: str) -> None:
        ws = self._ws
        if ws is None:
            return
        try:
            await ws.send(json.dumps({"type": "heartbeat", "request_id": request_id}))
        except Exception:
            logger.debug("[hermes-bridge] heartbeat send failed", exc_info=True)


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
    # Heartbeat: keep a slow-but-alive answer from being killed by the
    # relay's fixed ask_timeout_ms (see note_activity/forget_session above).
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
    ctx.register_hook("post_tool_call", _on_post_tool_call)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
    ctx.register_hook("on_session_end", _on_session_end)
