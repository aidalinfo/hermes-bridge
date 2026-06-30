"""Pure helpers for the hermes-bridge Hermes adapter.

No Hermes imports here on purpose: this module is unit-testable standalone,
without a real Hermes runtime on the import path. `adapter.py` imports these
helpers and wires them into Hermes' platform-adapter machinery.
"""
from __future__ import annotations

import json
from typing import Any, Dict

_REQUIRED_FIELDS = ("request_id", "conversation_id", "from", "message")


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
