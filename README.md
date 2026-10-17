# Warehouse Layout Editor

A browser-based editor for warehouse floor layouts — zones, rack rows, path
nodes/edges, and a calibrated background tracing image — with a live 2D plan and
a 3D preview. Layouts export to JSON, can be saved to a Firebase account, and
can be stored in Postgres.

The app is a static client (HTML/CSS/ES modules + a vendored copy of three.js).
Python is used for a tiny dev server and the optional database layer.

---

## Quick start (run it with Python)

You need **Python 3.10+**. No build step, no `npm install` required to run.

```bash
# from the repository root
python -m server.dev_server
```

Open the printed URL — **http://localhost:8000**. That's it.

> The server always serves the `app/` folder, so you can launch it from the repo
> root and the app finds its data correctly. The app must be served over HTTP
> (it uses ES modules and `fetch`); opening `app/index.html` as a `file://` page
> will show an error instead of the editor.

If you'd rather use any other static server, point it at the `app/` directory:

```bash
cd app
python -m http.server 8000      # then open http://localhost:8000
```

### Using the editor

- **Toolbar:** grouped into dropdown menus — **Select/Move**, **+ Add** (Zone,
  Node, Path Edge, Text), **Building**, **Warehouse**, **Delete**, **View** (2D
  Plan, 3D Preview, Center map), **Labels**, **Undo**, **Redo** and **File**
  (Import / Export JSON). Dragging out a zone shows its **width × depth and floor
  area live** as you size the rectangle. Any placed element can be copied with
  **Ctrl+C**, cut with **Ctrl+X**, pasted with **Ctrl+V** (repeated pastes
  stair-step away) and duplicated with **Ctrl+D**; the copy keeps its footprint
  and rotation and gets a fresh id, so it saves and undo/redo like any other edit.
- **Properties panel:** the left panel is contextual — it shows the form for the
  selected element and nothing else competes for the space. The warehouse-wide
  sections (**Background image**, **Bin types**, **Plan settings**, **Keyboard &
  tips**) fold into a single **Layout settings** row while something is selected,
  and open again when the selection is cleared. Each form is grouped by topic
  (_Footprint_, _Row layout_, _Position_, _Aisle & rows_, _Bins_ …) with related
  fields paired on one row, and the destructive action sits alone in the footer.
  With nothing selected the panel carries the **Building** name and the
  **Label defaults** every label without an override inherits.
- **Selecting several elements:** `Shift`+click adds an element to the selection
  (and clicking it again drops it back out); `Shift`+drag sweeps a rubber band
  over the plan, picking up the rack rows, elements and text under it — the floor
  zones they sit on are left alone, so a band over a block of rows does not grab
  the zone. **Ctrl+A** grabs every rack row at once. Once several things are
  picked, drag any one of them to **move the whole group rigidly** (grid snap
  comes from the element you grabbed), or **Ctrl+C / Ctrl+V** to copy and paste
  them together — the block keeps its shape and repeated pastes march away a row
  pitch as a unit. **Ctrl+D** duplicates the group and **Del** removes it, both in
  a single undoable step. Clicking one member without dragging drops the group
  back to that one element, and a click on empty space clears the selection.
- **Rack row spacing:** every rack row has an **Aisle (m)** field — the clear gap
  kept between it and the next row. The panel shows the derived **row pitch**
  (`depth + aisle`); Copy, Paste and `Ctrl`+`D` now land the copy exactly one row
  apart, and **Add rows ↓ / →** lays a whole block of identical rows at that pitch
  in one click. While a row is selected its reserved aisle is shaded on the plan
  with its width. Set a warehouse-wide **Rack aisle (m)** default in **Plan
  settings**, then override it per row — or clear a row's field to fall back to
  the default.
- **New rack row dialog:** drawing a rack row (Warehouse → **Rack Row**, or `R`)
  opens a spec sheet _before_ the row is created, prefilled from the drag. Size the
  run the way a consultant would: **row token, direction, start x/y, bays, levels,
  level height**, the **bin size** (bay width / depth / height / colour) and the
  **aisle** plus **rows to add**. It also gives the block a **Back-to-back pair**
  toggle (two rows sharing a spine) and a live readout of row length, pitch,
  total pallet positions, the row tokens it will use, and which equipment the
  aisle clears. Pick an existing bin type to load its size, or a **new** one — a
  bin size that is not already saved is stored as a named type so the same pallet
  footprint can be reused later. The whole block is added in one undoable step;
  `Esc` or **Cancel** adds nothing.
- **Building & Warehouse elements:** the **Building** menu drops pre-drawn
  facility parts — single/double/swing doors, **shutter door**, window, gate,
  **dock leveller**, dock shelter, bollard, wall, column, staircase, toilet, sink,
  office desk, table, meeting table, chair and cabinet. The **Warehouse** menu
  holds the rack-row tool plus **pallet**, **forklift**, **BOPT** (powered pallet
  truck) and **HPT** (hand pallet truck). Click the plan to drop one, then drag it
  to move, **drag the corner square to resize**, and rotate in 90° steps from the
  properties panel (with a _Duplicate_ shortcut). Changing an element's **Kind**
  re-shapes it to that element's typical footprint — unless you already resized
  it by hand, in which case your size is kept. Placed elements are real layout
  data: they save, import/export, participate in undo/redo, and appear in the 3D
  preview as proper models — a forklift with its mast, forks, overhead guard and
  wheels; a slatted pallet; a pallet truck with its raked tiller; a staircase of
  treads; desks and chairs on legs — each built from the same footprint the plan
  symbol draws, so 2D and 3D agree.
- **Keyboard:** `V` select · `Z` zone · `R` rack · `N` node · `E` edge ·
  `T` text · `X` delete · `Esc` cancel · `Del` remove selected · `Ctrl`+`Z` undo
  · `Ctrl`+`Y` (or `Ctrl`+`Shift`+`Z`) redo · `Ctrl`+`C` / `Ctrl`+`X` / `Ctrl`+`V`
  / `Ctrl`+`D` copy, cut, paste and duplicate · `Ctrl`+`A` select all rack rows ·
  `Shift`+click / `Shift`+drag extend the selection.
- **Undo / Redo:** the toolbar buttons walk your edits (up to 80 steps back).
  Every layout change is covered — drawing, moving, deleting, property edits,
  bin types, settings, import, and the background image — and a drag or a burst
  of typing counts as a single step. View-only actions (pan, zoom, tool choice,
  labels, selection) are not undoable.
- **Labels & text:** the `Labels` button (or `L`) hides every label at once. The
  **+Text** tool (or `T`) clicks a caption onto the plan; it is then a normal
  object you can drag, **resize by dragging its corner square**, restyle and
  delete.
- **Font toolbar:** click any label (a zone name, rack row, bay or node) or any
  text object and a floating **Font** toolbar appears beside it — font family,
  size (with the `A↑`/`A↓` buttons and the size box), **B**, _I_, U, alignment,
  highlight and font colour. It edits **that one label only**; every other label
  keeps its own look. Drag the corner square to resize the selection by mouse.
  _Reset this label_ clears one label's styling, while _Label defaults_ in the
  sidebar (shown when nothing is selected) sets the look used by labels that
  carry no override, including per-group show/hide.
- **Canvas:** drag to move a selected object, scroll to zoom. Pan the plan by
  dragging empty space (Select tool), right- or middle-dragging, holding `Space`
  and dragging, or with the **arrow keys** (`Shift`+arrow for bigger steps).
  The editor **opens centered on the layout, zoomed to fit**, so a fresh start
  never lands off the plan. Get lost? **Center map** in the toolbar (or `Home`)
  recenters on the layout and zooms to fit it.
- **2D Plan / 3D Preview** toggle in the toolbar.
- **Export JSON / Import JSON** for sharing or version-controlling a layout.
- **Cloud saving — several layouts, account required:** keeping more than one
  layout is an account feature. Sign in with Google or an email address and
  _File →_ gives you **New layout…**, **My layouts…** and **Save now**
  (`Ctrl+S`). Saving, opening, renaming and deleting several layouts all happen in
  the **My layouts** dialog, which shows which layout you are editing and marks
  the open one in the list. A new layout can start **blank**, from the **sample**,
  or as a **copy of the layout on screen** — and it is saved to your account
  _before_ it replaces what you are working on, so a failed save cannot cost you
  your work. Once a layout is in the account its **changes sync automatically** a
  couple of seconds after you stop typing — the toolbar shows _unsaved · saving…
  · synced_, or a _not synced_ warning if the connection drops, and `Ctrl+S` just
  syncs at once. The saved layout you are editing is remembered across reloads, so
  it never turns into a duplicate. Signed out, the editor works exactly as before
  on a single local draft. It is off until you add a Firebase config — see
  [docs/firebase.md](docs/firebase.md).

Your edits autosave to the browser's `localStorage`, so a reload keeps your work.
To reset back to the shipped default, run this in the browser console (F12) and
reload:

```js
localStorage.removeItem('warehouse_layout_editor_v1');
```

---

## Coordinate system

- **Origin (0, 0)** is the SW (south-west) corner of Zone E.
- **+x = East**, **+y = North**, **+z = Up** (elevation), all in **metres**.
- The 2D plan shows the origin with red (East) and green (North) axis arrows and
  a fixed **N** compass in the top-right corner (north is always screen-up in 2D).
- The 3D preview shows an origin marker at (0, 0, 0) with labeled **+X East**,
  **+Y North**, **+Z Up** axes.

---

## Updating the data

There are two kinds of "data," and they're separate on purpose:

1. **The shipped default layout** — `app/data/default_layout.json`. This is what
   a brand-new browser (with no saved draft) loads. Edit this file to change the
   starting layout for everyone. It is plain JSON; reload the page to see changes.
   After editing, the test suite will tell you if you broke the structure
   (`pytest tests/test_layout_schema.py`).

2. **A working layout you're editing** — lives in the browser and in exported
   JSON files. Use **Export JSON** to save one to disk and **Import JSON** to
   load it back.

### Save format (db_connect-native)

Exported files use the **db_connect shape**, which feeds directly into the WMS
pipeline. Top-level keys: `meta` (with `coordinate_system` and
`bin_label_format`), `settings`, `categories`, `binTypes`, `vehicles`,
`dwell_times`, `zones`, `fixtures`, `nodes`, `edges`, `racks`, `bins`, and an
`editor` extension block (`schemaVersion`, `naming`, `binOverrides`, `labels`,
`labelOverrides`, `texts`).

`fixtures` are the placed **building and warehouse elements** (doors, windows,
dock levellers, furniture, pallets, trucks) from the Building / Warehouse menus.
Each is `{ id, kind, x, y, w, d, rot }`: a centre point, a footprint in metres and
a quarter-turn rotation (`0`, `90`, `180` or `270`).

`bins` are **generated on every save** — not stored on rack objects. Each bin
carries a `whse_location`: the 3-part HomeSource join key `ROW-BAY-LEVEL`
(e.g. `C-01-1`). Zone is a separate field on the bin record and does not appear
in the label string. (db_connect's sample uses a 4-part zone-prefixed form;
the 3-part form matches the WMS join-key format.)

See **[docs/step4-mapping.md](docs/step4-mapping.md)** for the full field-by-field
mapping between the editor's internal model and the db_connect file format.

### Schema versioning

Layout files carry a version in `editor.schemaVersion`. When the format changes,
bump `SCHEMA_VERSION` in `app/js/schema.js` and add a migration in
`app/js/migrations.js`. Old drafts and imported files are migrated automatically
on load. The translator pair (`toDbConnect` / `fromDbConnect` in
`app/js/dbconnect.js`) handles conversion between the editor's internal state and
the on-disk format.

---

## Storing layouts in Postgres (optional)

The editor works without a database. If you want central storage, see
**[docs/postgres.md](docs/postgres.md)** — it covers installing the driver,
setting `DATABASE_URL`, creating the schema, seeding the default, and reading /
writing layouts from Python. In short:

```bash
pip install -r requirements.txt
export DATABASE_URL="postgresql://user:password@localhost:5432/warehouse"
python -m server.seed
```

---

## Project structure

```
warehouse-layout-editor/
├── app/                      # the static client (this is the web root)
│   ├── index.html
│   ├── css/styles.css
│   ├── data/default_layout.json   # shipped default layout (edit this)
│   ├── js/
│   │   ├── main.js           # entry point: load layout, start editor
│   │   ├── editor.js         # 2D plan editor (tools, drawing, panels, I/O)
│   │   ├── history.js        # undo/redo timeline over layout snapshots
│   │   ├── labels.js         # label visibility, per-label style, text objects
│   │   ├── fixtures.js       # catalogue + model for placed building/warehouse elements
│   │   ├── symbols.js        # 2D plan symbols for those elements
│   │   ├── models3d.js       # 3D shape of each element (parts, in metres)
│   │   ├── preview3d.js      # 3D preview
│   │   ├── cloud.js          # Firebase auth + Firestore (loaded on demand)
│   │   ├── cloudDocs.js      # pure: the shape of a saved layout, naming rules
│   │   ├── firebase-config.js # paste your Firebase web config here
│   │   ├── store.js          # localStorage draft + default fetch
│   │   ├── migrations.js     # schema migrations
│   │   ├── schema.js         # schema version + validator
│   │   ├── geometry.js       # pure layout math + bin expansion
│   │   └── dbconnect.js      # toDbConnect / fromDbConnect (db_connect format)
│   └── vendor/three.module.js
├── server/                   # Python: dev server + Postgres layer
│   ├── dev_server.py         # python -m server.dev_server
│   ├── persistence.py        # LayoutRepository (psycopg)
│   ├── layout_schema.py      # Python mirror of the JS validator
│   ├── config.py             # DATABASE_URL
│   └── seed.py               # python -m server.seed
├── schema/0001_init.sql      # Postgres DDL
├── firestore.rules           # Firebase rules: each user sees only their own
├── firebase.json             # firebase deploy --only firestore:rules
├── tests/                    # pytest + node --test
├── docs/postgres.md, docs/firebase.md
├── VERSION, CHANGELOG.md, LICENSE, .gitignore
└── pyproject.toml, package.json, eslint.config.js, .prettierrc.json
```

---

## Development

```bash
# Python: lint, format check, tests
pip install -r requirements-dev.txt
ruff check .
ruff format --check .
pytest

# JavaScript: unit tests (no install needed), plus optional lint/format
node --test tests/js/
npm install        # only needed for eslint/prettier
npm run lint
npm run format
```

CI runs all of the above on every push and pull request
(`.github/workflows/ci.yml`).

The JS unit tests cover the pure modules (`geometry.js`, `migrations.js`,
`dbconnect.js`, `labels.js`, `history.js`, `fixtures.js`, `symbols.js`,
`models3d.js`, `cloudDocs.js`); the editor and the 3D rendering itself are
exercised by hand in the browser.

---

## Vendoring three.js

The 3D preview requires `app/vendor/three.module.js` (three.js r128 ES module).
It is not included in the repository — vendor it once:

```bash
cd /tmp && npm pack three@0.128.0 && tar xzf three-0.128.0.tgz
cp package/build/three.module.js <repo>/app/vendor/three.module.js
```

The 2D editor works without it; only clicking "3D Preview" requires the file.

---

## Versioning

The project uses [Semantic Versioning](https://semver.org/); the current release
is in [`VERSION`](VERSION) and changes are recorded in
[`CHANGELOG.md`](CHANGELOG.md). Note this is distinct from the layout
`schemaVersion`, which versions the data format rather than the app.

## Committing to GitHub

See **[docs/git-and-github.md](docs/git-and-github.md)** for first-commit, remote
setup, and push instructions. In short, from the repo root:

```bash
git init && git add . && git commit -m "Initial commit: warehouse layout editor v0.1.0"
git tag -a v0.1.0 -m "v0.1.0"
# then create a remote and: git push -u origin main && git push --tags
```

## License

MIT — see [`LICENSE`](LICENSE).
