import importlib.util
import json
from pathlib import Path

import pytest

# Load wake.py directly by file path rather than via sys.path + `import wake`.
# adapter/ now has an __init__.py (required by Hermes' plugin loader — see
# adapter/__init__.py), so adding adapter/ to sys.path and importing `wake`
# risks pulling in adapter/__init__.py -> adapter.py -> `gateway.*`, which
# isn't installed outside a real Hermes runtime. This keeps the test fully
# standalone, as intended (see README: "wake.py — logique pure, sans
# dépendance Hermes").
_spec = importlib.util.spec_from_file_location(
    "wake", Path(__file__).resolve().parents[1] / "wake.py"
)
wake = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wake)
build_wake_text = wake.build_wake_text
parse_wake_payload = wake.parse_wake_payload
session_chat_id = wake.session_chat_id
extract_request_id = wake.extract_request_id
platform_value = wake.platform_value


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


def test_extract_request_id_round_trips_through_build_wake_text():
    text = build_wake_text(
        {
            "request_id": "3b357adf-9f17-4907-a6d8-a3c202f6dfc1",
            "conversation_id": "conv-1",
            "from": "helpdesk-bot",
            "message": "hi",
        }
    )
    assert extract_request_id(text) == "3b357adf-9f17-4907-a6d8-a3c202f6dfc1"


def test_extract_request_id_returns_none_when_absent():
    assert extract_request_id("just a normal message, no ids here") is None


def test_platform_value_unwraps_an_enum_like_object_with_a_value_attribute():
    class FakePlatform:
        value = "hermes-bridge"

    assert platform_value(FakePlatform()) == "hermes-bridge"


def test_platform_value_passes_through_a_plain_string():
    assert platform_value("hermes-bridge") == "hermes-bridge"


def test_platform_value_of_none_is_empty_string():
    assert platform_value(None) == ""
