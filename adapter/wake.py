"""Pure helpers for the hermes-bridge Hermes adapter.

No Hermes imports here on purpose: this module is unit-testable standalone,
without a real Hermes runtime on the import path. `adapter.py` imports these
helpers and wires them into Hermes' platform-adapter machinery.
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

_REQUIRED_FIELDS = ("request_id", "conversation_id", "from", "message")

# Matches the "request_id=<id>" this module's own build_wake_text() embeds in
# the wake text. Used by adapter.py's heartbeat hooks to read the request_id
# back out of Hermes' pre_llm_call kwargs (agent.session_id has no relation
# to anything the adapter can precompute — see adapter.py for the full story).
_REQUEST_ID_IN_TEXT_RE = re.compile(r"request_id=([^,\s)]+)")


def session_chat_id(conversation_id: str) -> str:
    """Stable Hermes chat_id for a hermes-bridge conversation (session continuity)."""
    return f"hermes-bridge:{conversation_id}"


def build_wake_text(payload: Dict[str, Any]) -> str:
    """Render the prompt text injected into the target agent's turn for an incoming wake."""
    request_id = payload["request_id"]
    conversation_id = payload["conversation_id"]
    sender = payload["from"]
    message = payload["message"]
    return (
        f"[hermes-bridge] Message de {sender} "
        f"(request_id={request_id}, conversation_id={conversation_id}) : {message}\n"
        f'Réponds avec le tool reply(request_id="{request_id}", answer=...), '
        f'ou continue la conversation avec ask_agent(to, message, conversation_id="{conversation_id}").'
    )


def extract_request_id(wake_text: str) -> Optional[str]:
    """Read a request_id back out of text built by build_wake_text(), or None."""
    match = _REQUEST_ID_IN_TEXT_RE.search(wake_text)
    return match.group(1) if match else None


def platform_value(value: Any) -> str:
    """Unwrap a `gateway.config.Platform` enum member to its string value.

    Hermes hook kwargs hand back whatever `agent.platform` holds, which is
    the Enum member itself (Platform is a plain Enum, not `str, Enum`) —
    comparing it directly to a literal like "hermes-bridge" is always False.
    Same workaround the bundled `raft` adapter uses for this exact contract.
    """
    return str(getattr(value, "value", value) or "")


def parse_wake_payload(raw: str) -> Dict[str, Any]:
    """Parse and validate a raw WebSocket text frame into a wake payload dict.

    Raises ValueError if the payload is not a JSON object or is missing a
    required string field.
    """
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("wake payload is not valid JSON") from exc
    if not isinstance(data, dict):
        raise ValueError("wake payload must be a JSON object")
    for field in _REQUIRED_FIELDS:
        if not isinstance(data.get(field), str) or not data[field]:
            raise ValueError(f"wake payload missing required string field '{field}'")
    return data
