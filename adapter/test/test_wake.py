import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wake import build_wake_text, parse_wake_payload, session_chat_id


def test_session_chat_id_is_namespaced_by_conversation():
    assert session_chat_id("conv-123") == "hermes-bridge:conv-123"


def test_build_wake_text_includes_request_and_conversation_ids():
    text = build_wake_text(
        {
            "request_id": "req-1",
            "conversation_id": "conv-1",
            "from": "daniel-bot",
            "message": "what's the weather?",
        }
    )
    assert "daniel-bot" in text
    assert "req-1" in text
    assert "conv-1" in text
    assert "what's the weather?" in text
    assert "reply(" in text
    assert "ask_agent(" in text


def test_parse_wake_payload_accepts_a_valid_json_object():
    raw = json.dumps(
        {"request_id": "req-1", "conversation_id": "conv-1", "from": "daniel-bot", "message": "hi"}
    )
    payload = parse_wake_payload(raw)
    assert payload["request_id"] == "req-1"
    assert payload["message"] == "hi"


def test_parse_wake_payload_rejects_non_json():
    with pytest.raises(ValueError):
        parse_wake_payload("not json")


def test_parse_wake_payload_rejects_a_json_array():
    with pytest.raises(ValueError):
        parse_wake_payload("[1, 2, 3]")


@pytest.mark.parametrize("missing_field", ["request_id", "conversation_id", "from", "message"])
def test_parse_wake_payload_rejects_missing_required_fields(missing_field):
    payload = {
        "request_id": "req-1",
        "conversation_id": "conv-1",
        "from": "daniel-bot",
        "message": "hi",
    }
    del payload[missing_field]
    with pytest.raises(ValueError):
        parse_wake_payload(json.dumps(payload))
