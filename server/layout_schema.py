"""Structural validation for a layout dict.

This mirrors app/js/schema.js so the same rules apply whether a layout is checked
in the browser or on the server (e.g. before writing it to the database). It is a
lightweight check, not a full JSON-Schema validator.
"""

from __future__ import annotations

from numbers import Real

SCHEMA_VERSION = 7

# Quarter turns are the only fixture rotations, which keeps the footprint exact.
FIXTURE_ROTATIONS = (0, 90, 180, 270)

# Editor-native kinds plus db_connect kinds tolerated on import (DEBT-005).
NODE_KINDS = {
    "door",
    "ramp",
    "junction",
    "dock",
    "staging",
    "charge",
    "access_point",
    "waypoint",
    "staging_area",
    "reference_marker",
}
RACK_DIRS = {"E", "N"}


def _is_number(v) -> bool:
    return isinstance(v, Real) and not isinstance(v, bool)


def validate_layout(layout) -> list[str]:
    """Return a list of human-readable errors. Empty list means valid."""
    errors: list[str] = []

    if not isinstance(layout, dict):
        return ["layout is not an object"]

    if layout.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(
            f"schemaVersion must be {SCHEMA_VERSION} "
            f"(got {layout.get('schemaVersion')!r}); run a migration first"
        )

    meta = layout.get("meta")
    if not isinstance(meta, dict) or not isinstance(meta.get("name"), str):
        errors.append("meta.name must be a string")

    for key in ("zones", "nodes", "edges", "racks"):
        if not isinstance(layout.get(key), list):
            errors.append(f"{key} must be an array")
    if not isinstance(layout.get("binTypes"), dict):
        errors.append("binTypes must be an object")

    # naming config
    naming = layout.get("naming")
    if not isinstance(naming, dict):
        errors.append("naming must be an object")
    else:
        if not isinstance(naming.get("separator"), str):
            errors.append("naming.separator must be a string")
        bay_pad = naming.get("bayPad")
        if not isinstance(bay_pad, int) or isinstance(bay_pad, bool) or bay_pad < 1:
            errors.append("naming.bayPad must be a positive integer")

    # binOverrides
    bin_overrides = layout.get("binOverrides")
    if not isinstance(bin_overrides, dict):
        errors.append("binOverrides must be an object")

    # Placed building / warehouse elements (doors, windows, dock levellers,
    # furniture, pallets, trucks). Additive: v6 files simply omit it.
    fixtures = layout.get("fixtures")
    if fixtures is not None:
        if not isinstance(fixtures, list):
            errors.append("fixtures must be an array")
        else:
            for i, fx in enumerate(fixtures):
                if not isinstance(fx, dict):
                    errors.append(f"fixtures[{i}] must be an object")
                    continue
                if not isinstance(fx.get("id"), str):
                    errors.append(f"fixtures[{i}].id must be a string")
                if not isinstance(fx.get("kind"), str):
                    errors.append(f"fixtures[{i}].kind must be a string")
                if not _is_number(fx.get("x")) or not _is_number(fx.get("y")):
                    errors.append(f"fixtures[{i}] needs numeric x,y")
                if not _is_number(fx.get("w")) or fx["w"] <= 0:
                    errors.append(f"fixtures[{i}].w must be a positive number")
                if not _is_number(fx.get("d")) or fx["d"] <= 0:
                    errors.append(f"fixtures[{i}].d must be a positive number")
                if fx.get("rot") not in FIXTURE_ROTATIONS:
                    errors.append(
                        f"fixtures[{i}].rot must be one of "
                        f"{', '.join(str(r) for r in FIXTURE_ROTATIONS)}"
                    )

    # Optional editor extensions. Layouts written before free text / label
    # styling existed simply omit them, so these are only checked when present.
    texts = layout.get("texts")
    if texts is not None:
        if not isinstance(texts, list):
            errors.append("texts must be an array")
        else:
            for i, t in enumerate(texts):
                if not isinstance(t, dict):
                    errors.append(f"texts[{i}] must be an object")
                    continue
                if not isinstance(t.get("id"), str):
                    errors.append(f"texts[{i}].id must be a string")
                if not isinstance(t.get("text"), str):
                    errors.append(f"texts[{i}].text must be a string")
                if not _is_number(t.get("x")) or not _is_number(t.get("y")):
                    errors.append(f"texts[{i}] needs numeric x,y")
                if not _is_number(t.get("size")) or t["size"] <= 0:
                    errors.append(f"texts[{i}].size must be a positive number")

    label_style = layout.get("labelStyle")
    if label_style is not None:
        if not isinstance(label_style, dict):
            errors.append("labelStyle must be an object")
        else:
            if not _is_number(label_style.get("scale")) or label_style["scale"] <= 0:
                errors.append("labelStyle.scale must be a positive number")
            if not isinstance(label_style.get("font"), str):
                errors.append("labelStyle.font must be a string")

    label_overrides = layout.get("labelOverrides")
    if label_overrides is not None:
        if not isinstance(label_overrides, dict):
            errors.append("labelOverrides must be an object")
        else:
            for key, ov in label_overrides.items():
                if not isinstance(ov, dict):
                    errors.append(f"labelOverrides[{key}] must be an object")
                    continue
                if ov.get("size") is not None and (
                    not _is_number(ov.get("size")) or ov["size"] <= 0
                ):
                    errors.append(f"labelOverrides[{key}].size must be a positive number")
                if ov.get("font") is not None and not isinstance(ov.get("font"), str):
                    errors.append(f"labelOverrides[{key}].font must be a string")

    for i, z in enumerate(layout.get("zones") or []):
        for k in ("x", "y", "w", "d", "elev", "clearH"):
            if not _is_number(z.get(k)):
                errors.append(f"zones[{i}].{k} must be a number")
        if not isinstance(z.get("id"), str):
            errors.append(f"zones[{i}].id must be a string")

    node_ids = set()
    for i, n in enumerate(layout.get("nodes") or []):
        if not isinstance(n.get("id"), str):
            errors.append(f"nodes[{i}].id must be a string")
        else:
            node_ids.add(n["id"])
        if not _is_number(n.get("x")) or not _is_number(n.get("y")):
            errors.append(f"nodes[{i}] needs numeric x,y")
        if n.get("kind") and n["kind"] not in NODE_KINDS:
            errors.append(f"nodes[{i}].kind {n['kind']!r} is not a known kind")

    for i, e in enumerate(layout.get("edges") or []):
        if e.get("a") not in node_ids:
            errors.append(f"edges[{i}].a {e.get('a')!r} references a missing node")
        if e.get("b") not in node_ids:
            errors.append(f"edges[{i}].b {e.get('b')!r} references a missing node")

    bin_type_names = set((layout.get("binTypes") or {}).keys())
    for i, r in enumerate(layout.get("racks") or []):
        if not isinstance(r.get("id"), str):
            errors.append(f"racks[{i}].id must be a string")
        if r.get("dir") not in RACK_DIRS:
            errors.append(f"racks[{i}].dir must be one of {sorted(RACK_DIRS)}")
        if not isinstance(r.get("bays"), int) or r.get("bays", 0) < 1:
            errors.append(f"racks[{i}].bays must be a positive integer")
        if not isinstance(r.get("levels"), int) or r.get("levels", 0) < 1:
            errors.append(f"racks[{i}].levels must be a positive integer")
        level_heights = r.get("levelHeights")
        if not isinstance(level_heights, list):
            errors.append(f"racks[{i}].levelHeights must be an array")
        else:
            if len(level_heights) != r.get("levels", 0):
                errors.append(
                    f"racks[{i}].levelHeights.length ({len(level_heights)}) "
                    f"must equal levels ({r.get('levels')})"
                )
            if not all(_is_number(h) and h > 0 for h in level_heights):
                errors.append(f"racks[{i}].levelHeights must contain only positive numbers")
        row_token = r.get("rowToken")
        if not isinstance(row_token, str) or len(row_token) == 0:
            errors.append(f"racks[{i}].rowToken must be a non-empty string")
        bay_start = r.get("bayStart")
        if not isinstance(bay_start, int) or isinstance(bay_start, bool) or bay_start < 1:
            errors.append(f"racks[{i}].bayStart must be a positive integer")
        if not isinstance(r.get("bayReverse"), bool):
            errors.append(f"racks[{i}].bayReverse must be a boolean")
        aisle = r.get("aisle")
        if aisle is not None and (not _is_number(aisle) or aisle < 0):
            errors.append(f"racks[{i}].aisle must be a non-negative number when present")
        if r.get("type") not in bin_type_names:
            errors.append(f"racks[{i}].type {r.get('type')!r} is not a defined bin type")
        blo = r.get("bayLevelOverrides")
        if blo is not None:
            if not isinstance(blo, dict):
                errors.append(f"racks[{i}].bayLevelOverrides must be an object")
            else:
                for bay_key, ov in blo.items():
                    if not isinstance(ov, dict):
                        errors.append(f"racks[{i}].bayLevelOverrides[{bay_key}] must be an object")
                        continue
                    ov_levels = ov.get("levels")
                    if (
                        not isinstance(ov_levels, int)
                        or isinstance(ov_levels, bool)
                        or ov_levels < 1
                    ):
                        errors.append(
                            f"racks[{i}].bayLevelOverrides[{bay_key}].levels "
                            f"must be a positive integer"
                        )
                    ov_heights = ov.get("levelHeights")
                    if not isinstance(ov_heights, list):
                        errors.append(
                            f"racks[{i}].bayLevelOverrides[{bay_key}].levelHeights must be an array"
                        )
                    else:
                        if isinstance(ov_levels, int) and len(ov_heights) != ov_levels:
                            errors.append(
                                f"racks[{i}].bayLevelOverrides[{bay_key}]"
                                f".levelHeights.length must equal levels"
                            )
                        if not all(_is_number(h) and h > 0 for h in ov_heights):
                            errors.append(
                                f"racks[{i}].bayLevelOverrides[{bay_key}]"
                                f".levelHeights must contain only positive numbers"
                            )

    return errors


_ORIENTATION_TO_DIR = {"length_along_x": "E", "length_along_y": "N"}


def from_db_connect(db_layout: dict) -> dict:
    """Convert a db_connect-format layout dict to editor-native state.

    Mirrors app/js/dbconnect.js fromDbConnect(). Strips derived fields (zone on
    nodes, distance_m on edges, units from settings). Pass-through fields
    (zone.operations, edge attributes, rack access_face, bayLevelOverrides etc.,
    binType extras) are preserved on their respective objects.
    """
    editor = db_layout.get("editor") or {}
    meta = dict(db_layout.get("meta") or {})
    meta.pop("schema_version", None)

    racks = []
    for r in db_layout.get("racks") or []:
        rack = dict(r)
        orientation = rack.pop("orientation", None)
        rack["dir"] = _ORIENTATION_TO_DIR.get(orientation, "N")
        racks.append(rack)

    edges = []
    for e in db_layout.get("edges") or []:
        edge = dict(e)
        edge.pop("distance_m", None)
        edges.append(edge)

    nodes = []
    for n in db_layout.get("nodes") or []:
        node = dict(n)
        node.pop("zone", None)
        nodes.append(node)

    settings = dict(db_layout.get("settings") or {})
    settings.pop("units", None)

    return {
        "schemaVersion": editor.get("schemaVersion", SCHEMA_VERSION),
        "meta": meta,
        "settings": settings,
        "naming": editor.get("naming", {"separator": "-", "bayPad": 2}),
        "binOverrides": editor.get("binOverrides", {}),
        "labelStyle": editor.get("labels"),
        "labelOverrides": editor.get("labelOverrides") or {},
        "texts": editor.get("texts") or [],
        "categories": db_layout.get("categories") or {},
        "binTypes": db_layout.get("binTypes") or {},
        "vehicles": db_layout.get("vehicles") or {},
        "dwell_times": db_layout.get("dwell_times") or {},
        "zones": db_layout.get("zones") or [],
        "fixtures": db_layout.get("fixtures") or editor.get("fixtures") or [],
        "nodes": nodes,
        "edges": edges,
        "racks": racks,
        "bg": db_layout.get("bg"),
    }
