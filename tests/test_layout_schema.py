"""Validate the shipped default layout and the validator itself."""

import copy
import json

from server import APP_DIR
from server.layout_schema import SCHEMA_VERSION, from_db_connect, validate_layout


def load_default():
    return json.loads((APP_DIR / "data" / "default_layout.json").read_text(encoding="utf-8"))


def test_default_layout_is_valid():
    state = from_db_connect(load_default())
    errors = validate_layout(state)
    assert errors == [], errors


def test_default_layout_is_current_schema_version():
    assert load_default()["editor"]["schemaVersion"] == SCHEMA_VERSION


def test_rejects_unknown_bin_type_in_rack():
    state = from_db_connect(load_default())
    state["racks"][0]["type"] = "DOES_NOT_EXIST"
    errors = validate_layout(state)
    assert any("is not a defined bin type" in e for e in errors)


def test_accepts_rack_aisle():
    state = from_db_connect(load_default())
    state["racks"][0]["aisle"] = 3.5
    assert validate_layout(state) == []


def test_rejects_negative_rack_aisle():
    state = from_db_connect(load_default())
    state["racks"][0]["aisle"] = -1
    errors = validate_layout(state)
    assert any("aisle" in e for e in errors)


def test_rejects_edge_to_missing_node():
    state = from_db_connect(load_default())
    state["nodes"].append({"id": "N1", "kind": "junction", "x": 0, "y": 0})
    state["nodes"].append({"id": "N2", "kind": "junction", "x": 1, "y": 1})
    state["edges"].append({"a": "N1", "b": "N2", "ramp": False})
    state["edges"][0]["a"] = "NO-SUCH-NODE"
    errors = validate_layout(state)
    assert any("references a missing node" in e for e in errors)


def test_rejects_wrong_schema_version():
    state = from_db_connect(load_default())
    state["schemaVersion"] = 1
    errors = validate_layout(state)
    assert any("schemaVersion must be" in e for e in errors)


def test_rejects_non_object():
    assert validate_layout([1, 2, 3]) == ["layout is not an object"]


def test_bool_is_not_a_number():
    # guards against True/False slipping through numeric checks
    layout = copy.deepcopy(load_default())
    layout["zones"][0]["x"] = True
    errors = validate_layout(layout)
    assert any("zones[0].x must be a number" in e for e in errors)


# ── bayLevelOverrides validation ─────────────────────────────────────────────


def _make_state_with_blo(blo):
    """Return an editor-native state where racks[0] has bayLevelOverrides=blo."""
    state = from_db_connect(load_default())
    state["racks"][0]["bayLevelOverrides"] = blo
    return state


def test_bayLevelOverrides_empty_is_valid():
    errors = validate_layout(_make_state_with_blo({}))
    assert errors == [], errors


def test_bayLevelOverrides_valid_entry_is_accepted():
    blo = {"0": {"levels": 3, "levelHeights": [4.0, 4.0, 4.0]}}
    errors = validate_layout(_make_state_with_blo(blo))
    assert errors == [], errors


def test_bayLevelOverrides_rejects_non_object():
    state = from_db_connect(load_default())
    state["racks"][0]["bayLevelOverrides"] = [1, 2, 3]
    errors = validate_layout(state)
    assert any("bayLevelOverrides must be an object" in e for e in errors)


def test_bayLevelOverrides_rejects_levels_zero():
    blo = {"1": {"levels": 0, "levelHeights": []}}
    errors = validate_layout(_make_state_with_blo(blo))
    assert any("levels must be a positive integer" in e for e in errors)


def test_bayLevelOverrides_rejects_levelHeights_length_mismatch():
    blo = {"1": {"levels": 2, "levelHeights": [3.0]}}
    errors = validate_layout(_make_state_with_blo(blo))
    assert any("levelHeights.length must equal levels" in e for e in errors)


def test_bayLevelOverrides_rejects_non_positive_height():
    blo = {"0": {"levels": 1, "levelHeights": [0.0]}}
    errors = validate_layout(_make_state_with_blo(blo))
    assert any("must contain only positive numbers" in e for e in errors)


def test_bayLevelOverrides_survives_from_db_connect_round_trip():
    layout = copy.deepcopy(load_default())
    layout["racks"][0]["bayLevelOverrides"] = {"2": {"levels": 1, "levelHeights": [3.5]}}
    state = from_db_connect(layout)
    assert state["racks"][0]["bayLevelOverrides"] == {"2": {"levels": 1, "levelHeights": [3.5]}}


# ── label style / free text (optional editor extensions) ─────────────────────


def test_texts_and_label_style_are_absent_by_default():
    state = from_db_connect(load_default())
    assert state["texts"] == []
    assert state["labelStyle"] is None


def test_accepts_well_formed_text_and_label_style():
    state = from_db_connect(load_default())
    state["texts"] = [
        {"id": "TXT-1", "text": "DOCK 3", "x": 1, "y": 2, "size": 1.6, "align": "center"}
    ]
    state["labelStyle"] = {"scale": 1.5, "font": "Arial"}
    errors = validate_layout(state)
    assert errors == [], errors


def test_rejects_text_with_non_positive_size():
    state = from_db_connect(load_default())
    state["texts"] = [{"id": "TXT-1", "text": "x", "x": 0, "y": 0, "size": 0}]
    errors = validate_layout(state)
    assert any("texts[0].size must be a positive number" in e for e in errors)


def test_rejects_text_without_a_text_field():
    state = from_db_connect(load_default())
    state["texts"] = [{"id": "TXT-1", "x": 0, "y": 0, "size": 1}]
    errors = validate_layout(state)
    assert any("texts[0].text must be a string" in e for e in errors)


def test_rejects_non_list_texts():
    state = from_db_connect(load_default())
    state["texts"] = {"nope": True}
    errors = validate_layout(state)
    assert any("texts must be an array" in e for e in errors)


def test_rejects_label_style_with_bad_scale_and_font():
    state = from_db_connect(load_default())
    state["labelStyle"] = {"scale": 0, "font": 5}
    errors = validate_layout(state)
    assert any("labelStyle.scale must be a positive number" in e for e in errors)
    assert any("labelStyle.font must be a string" in e for e in errors)


def test_label_overrides_default_to_empty():
    state = from_db_connect(load_default())
    assert state["labelOverrides"] == {}


def test_accepts_a_well_formed_label_override():
    state = from_db_connect(load_default())
    state["labelOverrides"] = {"zone:OFFICE": {"font": "Arial", "size": 3, "underline": True}}
    errors = validate_layout(state)
    assert errors == [], errors


def test_rejects_label_override_with_non_positive_size():
    state = from_db_connect(load_default())
    state["labelOverrides"] = {"zone:OFFICE": {"size": 0}}
    errors = validate_layout(state)
    assert any("labelOverrides[zone:OFFICE].size must be a positive number" in e for e in errors)


def test_rejects_non_dict_label_override_entry():
    state = from_db_connect(load_default())
    state["labelOverrides"] = {"zone:OFFICE": "nope"}
    errors = validate_layout(state)
    assert any("labelOverrides[zone:OFFICE] must be an object" in e for e in errors)


def test_label_overrides_survive_from_db_connect():
    layout = copy.deepcopy(load_default())
    layout["editor"]["labelOverrides"] = {"zone:OFFICE": {"font": "Arial"}}
    state = from_db_connect(layout)
    assert state["labelOverrides"] == {"zone:OFFICE": {"font": "Arial"}}


# -- fixtures (placed building / warehouse elements) --------------------------


def test_fixtures_default_to_empty():
    state = from_db_connect(load_default())
    assert state["fixtures"] == []


def test_accepts_a_well_formed_fixture():
    state = from_db_connect(load_default())
    state["fixtures"] = [{"id": "F-1", "kind": "door", "x": 4, "y": 9, "w": 1, "d": 0.16, "rot": 90}]
    errors = validate_layout(state)
    assert errors == [], errors


def test_rejects_fixture_with_bad_rotation():
    state = from_db_connect(load_default())
    state["fixtures"] = [{"id": "F-1", "kind": "door", "x": 4, "y": 9, "w": 1, "d": 0.16, "rot": 45}]
    errors = validate_layout(state)
    assert any("fixtures[0].rot must be one of" in e for e in errors)


def test_rejects_fixture_with_non_positive_footprint():
    state = from_db_connect(load_default())
    state["fixtures"] = [{"id": "F-1", "kind": "door", "x": 4, "y": 9, "w": 0, "d": -1, "rot": 0}]
    errors = validate_layout(state)
    assert any("fixtures[0].w must be a positive number" in e for e in errors)
    assert any("fixtures[0].d must be a positive number" in e for e in errors)


def test_rejects_fixture_with_missing_kind_and_position():
    state = from_db_connect(load_default())
    state["fixtures"] = [{"id": "F-1", "x": "here"}]
    errors = validate_layout(state)
    assert any("fixtures[0].kind must be a string" in e for e in errors)
    assert any("fixtures[0] needs numeric x,y" in e for e in errors)


def test_rejects_non_list_fixtures():
    state = from_db_connect(load_default())
    state["fixtures"] = {"nope": True}
    errors = validate_layout(state)
    assert any("fixtures must be an array" in e for e in errors)


def test_fixtures_survive_from_db_connect():
    layout = copy.deepcopy(load_default())
    fx = [{"id": "F-1", "kind": "pallet", "x": 1, "y": 2, "w": 1.2, "d": 0.8, "rot": 180}]
    layout["fixtures"] = fx
    state = from_db_connect(layout)
    assert state["fixtures"] == fx
