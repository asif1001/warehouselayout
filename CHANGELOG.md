# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Multi-selection of racks and elements**: `Shift`+click adds or removes one
  element, `Shift`+drag sweeps a rubber band over the plan (picking up rack rows,
  placed elements and text while ignoring the floor zones underneath) and
  `Ctrl`+`A` selects every rack row. Dragging any member then **moves the whole
  group rigidly** — the grabbed element supplies the grid snap, so the rest keep
  their exact relative spacing — and **Ctrl+C / Ctrl+V** copy and paste the group
  as a block: the shape is preserved and repeated pastes march one row pitch
  further on as a unit. `Ctrl+D` duplicates the group and `Del` deletes it, each
  in one undoable step. The properties panel shows the group, its size and a
  rack-row / pallet-position roll-up, with **Duplicate group** / **Delete group**
  buttons. `Shift`+clicking a row label or bay label toggles the row it belongs
  to, and clicking a selected member without dragging drops back to a single
  selection.
- **New rack row dialog**: the Rack Row tool now opens a spec sheet before the
  row exists, prefilled from the drag (start point, direction, a proposed bay
  count). It captures the row token, bays, levels and level height, the bin size
  (bay width / depth / height / colour) and the aisle, and can lay a whole block
  at once including optional **back-to-back pairs**. A live readout shows row
  length, pitch, total pallet positions, the tokens used and which equipment the
  aisle clears (hand pallet truck → reach truck → counterbalance forklift). A bin
  size that is not already a saved type is stored under its own name and reused
  next time. New pure helpers `aisleFit`, `rackBlockPositions`, `matchBinType`
  and `rowTokensFor` in `app/js/geometry.js`, unit-tested.
- **Undo / Redo**: toolbar buttons and `Ctrl`+`Z` / `Ctrl`+`Y`
  (`Ctrl`+`Shift`+`Z`) walk up to 80 steps back through layout edits. Every
  change funnels through the editor's existing `save()` path, so a drag or a
  burst of typing collapses into one step and a save that changes nothing adds
  none. Selection, panning, zooming, tool choice, and label visibility are
  excluded. New module `app/js/history.js` (`createHistory`), unit-tested.
- **Center map** toolbar button and the `Home` key: recenters the plan on the
  layout and zooms to fit. The fit is measured from what the last `draw()`
  actually painted, so it cannot drift from the rendering rules.
- **Live zone dimensions**: while you drag out a zone with the `+ Zone` tool the
  rectangle shows its width × depth and floor area as you size it (for example
  `32.0 × 22.0 m` and `704.0 m²`), plus a translucent fill so the footprint is
  clear.
- **Text tool** (`+Text`, `T`): click the plan to place a free-standing caption,
  then type in the panel. Text objects are real objects — drag to move, delete
  with `Del`, and **resize by dragging the corner square** or the `A↑`/`A↓`
  buttons. Rendered in both the 2D plan and the 3D preview.
- **Floating Font toolbar**: clicking a single label (zone name, rack row, bay or
  node) or a text object pops up a word-processor-style toolbar beside it —
  font family, size, `A↑`/`A↓`, **B**, _I_, U, alignment, highlight and colour.
  Edits apply to **that one label only**; other labels are untouched. Each
  automatic label has a stable key (`zone:OFFICE`, `bay:ROW-A#2`, …) so overrides
  are stored per label.
- **Label defaults** in the sidebar (shown when nothing is selected) cover every
  label without an override: font, base size, weight, italic, colour, halo and
  per-group show/hide. The existing `Labels` button (`L`) still hides them all at
  once.
- Both features are stored in the `editor` extension block (`labels`,
  `labelOverrides`, `texts`) with defaults applied on load, so existing files
  keep working unchanged.
- **Building & Warehouse menus** — a library of pre-drawn facility and equipment
  elements. **Building** offers single / double / shutter doors, window, gate,
  **dock leveller**, dock shelter, bollard, wall, column, staircase, toilet, sink,
  office desk, table, meeting table, chair and cabinet. **Warehouse** holds the
  rack-row tool plus **pallet**, **forklift**, **BOPT** (powered pallet truck) and
  **HPT** (hand pallet truck). Click the plan to drop one, drag to move, drag the
  corner square to resize, rotate in 90° steps from the panel, and duplicate.
  Elements are real layout data: undoable, saved, imported/exported, and drawn in
  the 3D preview. New pure modules `app/js/fixtures.js` (catalogue + model) and
  `app/js/symbols.js` (plan symbols), both unit-tested.
- **Copy / paste / cut / duplicate** (`Ctrl`+`C`, `Ctrl`+`V`, `Ctrl`+`X`,
  `Ctrl`+`D`) for any placed element — zone, rack row, node, text label or
  Building / Warehouse element. The copy keeps its footprint and rotation and
  gets a fresh id; repeated pastes stair-step away so they never land on top of
  each other. Every copy is undoable and saved like any other edit.
- **Rack row spacing (aisle)**: each rack row carries an optional `aisle` — the
  clear gap (metres) to the next row on its cross axis. The rack panel gains an
  **Aisle (m)** field with a live **row pitch** readout (`depth + aisle`), a
  **Rows to add** count with an **Add rows** button that clones the row into a
  whole block at that pitch, and a shaded, labelled aisle guide shown while the
  row is selected. `Ctrl`+`C` / `Ctrl`+`V` and `Ctrl`+`D` now place copies one
  row-pitch away (previously a fixed 1 m gap). A warehouse-wide default lives in
  Settings → **Rack aisle (m)**; a per-row value overrides it. The `aisle` field
  is optional and additive, so no schema bump is needed. New pure helpers in
  `app/js/geometry.js` (`rackAisle`, `rackFootprint`, `rackRowAxis`,
  `nextRackRow`), unit-tested, and `aisle` is validated by `validateLayout` (JS and
  the Python mirror).

### Changed

- **The 3D preview models each placed element** instead of blocking it in as one
  box. Warehouse equipment now reads at a glance: the forklift has a
  counterweight, an overhead guard, a mast with cross-members, two fork tines and
  four wheels; the pallet is a slatted deck on bearers; the pallet trucks have a
  power head, low tines, load wheels and a raked tiller (the powered one adds its
  battery box). Doors, windows (with a translucent pane), gates, dock shelters,
  staircases, WCs, sinks, desks, tables, meeting tables with their chairs and
  office chairs all get their own shapes too; bollards and columns stay round.
  The shapes are derived from the same fractions the 2D plan symbols draw in, so
  a model lines up with its symbol at every rotation. New pure module
  `app/js/models3d.js` (`fixtureParts`), unit-tested; a kind with no model still
  falls back to its footprint slab.
- **Contextual properties panel**: the sidebar now shows the form for the selected
  element and nothing else. The warehouse-wide sections (**Background image**,
  **Bin types**, **Plan settings**, **Keyboard & tips**) collapse into a single
  **Layout settings** row while an element is selected, and unfold again when the
  selection is cleared. Element forms are grouped by topic (_Footprint_,
  _Row layout_, _Position_, _Aisle & rows_, _Bins_ …) with related fields paired on
  one row, compact inputs and the destructive action set apart in a footer — and
  the previously unstyled bin-label list and bay readout now have real styling.
- **Toolbar reorganised into dropdown menus**: `+ Add` (Zone, Node, Path Edge,
  Text), `Building`, `Warehouse`, `View` (2D Plan, 3D Preview, Center map) and
  `File` (Import / Export JSON). Select/Move, Delete, Labels, Undo and Redo stay
  as one-click buttons. The active tool still lights up, along with the menu that
  owns it.
- **Schema v6 → v7**: adds the optional top-level `fixtures` array. A v6 file
  migrates to v7 on load with an empty `fixtures` list, so nothing renders
  differently until an element is actually placed. `validateLayout` (JS and the
  Python mirror) and `fromDbConnect` were extended, and the shipped default
  layout is now v7.

## [0.2.0] — 2026-06-23

### Added

- **db_connect-native save format** (schema v4→v5): layouts are now saved and
  loaded in the db_connect shape — top-level `meta` (with `coordinate_system` and
  `bin_label_format`), `settings`, `categories`, `binTypes`, `vehicles`,
  `dwell_times`, `zones`, `nodes`, `edges`, `racks`, generated `bins`, and an
  `editor` extension block (`naming`, `binOverrides`, `schemaVersion`). Feed
  directly into the WMS db_connect pipeline.
- **Generated `whse_location` bins**: on every save, bins are expanded from rack
  definitions and written to the file. Each bin carries a `whse_location` — the
  3-part HomeSource join key `ROW-BAY-LEVEL` (e.g. `C-01-1`). Zone is a separate
  field on the bin record and does not appear in the label string.
- **Lossless pass-through**: `categories`, `vehicles`, `dwell_times`,
  `zone.operations`, edge traffic attributes, and rack `access_face` /
  `back_to_back_spine` are preserved unchanged across load/save cycles.
- **Coordinate system declaration** (`meta.coordinate_system`): origin at the
  receiving station, +X East, +Y North, +Z Up, signed positions, no coordinate
  shift. Set by site survey (DEBT-010).
- **`app/js/dbconnect.js`**: `toDbConnect()` / `fromDbConnect()` translator pair.
- **Three-layer bin naming** (schema v3→v4): `pattern` (separator + bay-pad) +
  per-rack `rowToken` / `bayStart` / `bayReverse` overrides + per-bin
  `binOverrides`. Labels take the form `ROW-BAY-LEVEL` (e.g. `C-01-1`).
- **Per-level rack heights** (schema v2→v3): each rack stores an explicit
  `levelHeights` array; bin z-coordinates use cumulative heights.

### Fixed

- Mac 3D preview: touch-action pan/zoom conflict resolved (pointer-events
  suppressed on the canvas overlay).

### Schema

- `schemaVersion` is now `5` (in `editor.schemaVersion` in the file format).
  Migrations `2→3`, `3→4`, `4→5` are forward-only and run automatically on load.

## [0.1.0] — 2026-06-12

### Added

- 2D plan editor: zones, rack rows, path nodes, and path edges with select/move,
  add, and delete tools; snap and grid settings; background tracing image with
  two-point scale calibration.
- 3D preview of the current layout, including an origin marker, labeled X/Y/Z
  axes, and a north arrow.
- Origin axes and a fixed north compass in the 2D plan.
- JSON import/export; export enriches the layout with zone containment, edge
  distances, and expanded per-bin records.
- Layout **schema versioning** (`schemaVersion`) with forward-only migrations.
- Decoupled seed data: the default layout lives in `app/data/default_layout.json`.
- Python dev server that serves the `app/` web root with correct MIME types.
- Postgres persistence layer (schema + `LayoutRepository`) and a seed command.
- Test suite (pytest + `node --test`), linting/formatting (ruff, eslint,
  prettier), and GitHub Actions CI.

### Schema

- `schemaVersion` is now `2`. Migration `1 -> 2` lifts the format version out of
  `meta.version` into a top-level `schemaVersion`.
