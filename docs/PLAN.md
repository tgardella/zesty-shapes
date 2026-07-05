# Plan: A Rock-Solid Prompt Sequence for Building a Vector Editor with Fable 5

## Context

You want to build a simplified-but-genuinely-usable Illustrator-like vector graphics
editor and have **Fable 5** do the actual coding. The goal of *this* document is not to
build the tool — it's to produce the **prompts** you'll paste into Fable 5 to get the best
possible result.

Decisions locked in with you:
- **Stack:** React + Vite + TypeScript (multi-file project).
- **Approach:** a **phased prompt sequence** — a foundation split across two prompts (0a + 0b),
  then follow-up prompts that add tool groups incrementally.
- **Bar:** genuinely usable — real interactions, undo/redo, keyboard shortcuts, snapping.
- **Starting point:** this repo, project name **`zesty-shapes`**. The repo currently holds
  `README.md`, `.gitignore`, and `docs/` only — there is no `package.json` or `src/` yet, so
  Prompt 0a scaffolds Vite *into the existing repo* rather than into a fresh empty directory.

**Why phased, not one mega-prompt:** the full feature list is ~40 tools. No single generation
produces all of that well. The failure mode of one-shotting is that the model makes convenient
early choices (nested-tree document, canvas rendering, per-tool coordinate math) that make the
*hard* tools (Pen, Pathfinder, Direct Selection) require a rewrite. The fix is to spend the
first prompts entirely on **architecture that is expensive to reverse**, prove it with two
trivial tools, then add everything else additively.

**The single most important idea:** the foundation (Prompts 0a + 0b) ships *no interesting tools*.
It ships the document model, rendering pipeline, coordinate system, tool framework, undo system,
and geometry library — then proves all of it end-to-end with just a Rectangle tool and a Selection
tool. If the foundation is right, the other ~40 tools are additions, not rewrites.

**Why 0a + 0b:** the foundation is by far the largest, most load-bearing generation. Asking for
the geometry library, the full model, patch-based undo, the coordinate system, rendering, the
tool framework, snapping, UI, *and* two working tools in a single shot is exactly the over-scope
that makes a model stub. So the foundation is one architecture delivered in two generations:
**0a = substrate & model (+ a test harness)**, **0b = runtime & the two proving tools**. The
acceptance gate sits at the end of 0b.

---

## How to use this plan

1. Each phase below is a **copy-ready prompt**. Paste **Prompt 0a** first, let Fable 5 complete +
   verify it, then paste **Prompt 0b**. Only after 0b passes its acceptance gate do you move on.
2. Prepend the **Reusable Preamble** (below) to *every* phase prompt. It carries the
   architecture invariants forward so later prompts don't drift.
3. After each phase, run the **verification checklist** for that phase before continuing.
4. Only advance when the prior phase runs. Later phases assume the substrate the earlier ones
   built.

The prompts themselves are the deliverable. The rest of this file (rationale, ordering,
verification) is there so you know *why* each prompt says what it says and can adjust scope.

---

## The six hard-to-reverse decisions baked into the foundation

These come from an architecture review and are the reason the foundation prompts look the way
they do:

1. **Normalized, id-keyed node map** (`Record<NodeId, SceneNode>` + `children: NodeId[]`) as
   the document source of truth — *not* a nested object tree. O(1) lookup, reparenting, and
   undo diffs. `parent` and `children` are kept in sync atomically by the CRUD helpers.
2. **Anchor schema:** absolute handle coordinates, handles stored *on* the anchor, stable ids
   on anchors and subpaths, geometry in **local space** with `transform` applied at render.
   Pen, Curvature, Direct Selection, Scissors, Knife, variable-width, and type-on-path all
   depend on this.
3. **Parametric shapes with a `toPath()` derivation + explicit "Convert to Path"** — shapes stay
   editable (live corner radius, etc.) but every deep tool gets a uniform path substrate. Shape
   params define **local geometry only**; the node `transform` is the sole placement/orientation
   mechanism (see the Preamble's positioning rule).
4. **Patch-based command undo with transaction coalescing** (one drag = one undo step), a
   plain-JSON document, and selection kept largely *outside* history (but restored by structural
   commands on undo).
5. **One normalized pointer-event pipeline + screen/doc/local coordinate functions + a
   screen-space overlay** so 40 tools never re-derive coordinate or hit-testing math.
6. **Effective (world) transforms compose through the ancestor chain.** A node's on-screen
   placement is the product of *all ancestor group transforms* × its own `transform`, not just
   its own 6-tuple. A memoized `worldTransform(nodeId)` helper is the single source of truth;
   hit-testing and anchor editing convert screen→doc→**world**→local through it. Reparent/ungroup
   preserve each node's world position by baking the transform delta. This is the correctness
   backbone for every transform, group, and anchor-editing tool — and the classic thing that is
   painful to retrofit if the coordinate helpers only ever invert a single node's transform.

Rendering choice: **SVG-DOM scene graph** (React renders the document as SVG; a *separate*
screen-space SVG renders selection handles/marquee/guides). This makes vector export exact and
free, gives browser-native hit-testing, and matches React's declarative model. Canvas is
reserved only for future raster-heavy stretch features (mesh, brushes).

---

## Reusable Preamble (prepend to EVERY phase prompt)

```
You are building a simplified but genuinely usable Illustrator-like vector graphics editor
called "zesty-shapes". Stack: React + Vite + TypeScript. This is a phased build; honor the
architecture already established and extend it additively — do not restructure existing
foundations.

Non-negotiable architecture invariants:
- Document is the source of truth: a normalized, plain-JSON, id-keyed node map
  `nodes: Record<NodeId, SceneNode>` plus tree order via `children: NodeId[]`. `parent` and
  `children` stay in sync atomically. No class instances, functions, or Maps in the document —
  geometry helpers are pure free functions.
- Rendering: the document is an SVG DOM tree (React-rendered). A SEPARATE, screen-space SVG
  overlay renders selection handles, marquee, and snap guides. Overlay graphics are constant
  screen size at any zoom. Never bake pan/zoom into individual objects — only the root
  document <g transform> pans/zooms.
- Three explicit coordinate spaces (screen / document / local). All coordinate conversion goes
  through shared screenToDoc() / docToScreen() helpers. Anchor geometry is stored in LOCAL
  space; each node's affine transform (SVG 6-tuple [a,b,c,d,e,f]) is applied at render.
- EFFECTIVE TRANSFORM: a node's world placement is the product of ALL ancestor group transforms
  times its own transform — not just its own 6-tuple. A memoized worldTransform(nodeId) helper
  is the single source of truth. Hit-testing and anchor/handle editing go screen -> doc ->
  world -> local through worldTransform and its inverse. Reparent/ungroup PRESERVE each node's
  world position by baking the transform delta (ungroup pushes the group transform down into
  children).
- POSITIONING RULE: shape params (rect x/y/w/h, ellipse cx/cy/rx/ry, ...) define LOCAL geometry
  only. The node `transform` is the SOLE placement/orientation mechanism: move updates e,f;
  scale/rotate compose into the transform. Never move a shape by mutating its params. "Convert
  to Path" PRESERVES the node transform (bakes params into local-space anchors, keeps transform).
- Shapes are parametric (rect/ellipse/polygon/star/line keep their params) and implement
  toPath(); "Convert to Path" replaces a shape with an editable PathNode. Deep tools operate on
  PathNodes and auto-convert inputs.
- Anchors: absolute handle coords, handles stored on the anchor (handleIn/handleOut), stable
  ids on anchors and subpaths, type = corner|smooth|symmetric.
- State: Zustand + Immer, sliced (document / selection / viewport / tool / ui). Undo/redo is
  patch-based (Immer produceWithPatches) with semantic labels and TRANSACTION COALESCING — one
  drag gesture is ONE undo step. Bare selection changes do not create undo entries; structural
  commands restore selection on undo. Viewport is never undoable.
- Serialization: model -> SVG string is emitted DIRECTLY from the model (pathData + a defs
  registry), independent of the React DOM — this is the single source of truth for export.
  Document <-> JSON must round-trip with node/subpath/anchor ids preserved exactly.
- defs registry: gradient/pattern Paints allocate STABLE <defs> ids, dedupe identical paints,
  and are garbage-collected when their last user is deleted. Reserve this even while only solid
  fill ships.
- Tools implement a shared Tool interface (onPointerDown/Move/Up, onKeyDown, cursor, shortcut)
  and receive a normalized ToolPointerEvent already carrying document-space point, screen
  point, snapped point, modifiers, top-hit node, and delta-from-down. Tools issue commands via
  the store API and NEVER write raw state. A central ToolManager handles active-tool dispatch,
  global modifiers (Space=pan, Esc=cancel gesture, Shift=constrain/add), and the shortcut map.

Authoritative shortcut map (the registry maps shortcut -> Tool; do not collide with these):
  V Selection | A Direct Selection | M Rectangle | L Ellipse | \ Line | P Pen | N Pencil |
  S Scale | R Rotate | G Gradient | I Eyedropper | T Type | Y Magic Wand | Q Lasso | B Paintbrush |
  W Blend | U Gradient Mesh | Shift+M Shape Builder | Shift+W Width | Shift+E Eraser |
  Shift+O Artboard | Shift+S Symbol Sprayer | Shift+B Blob Brush.
  Polygon/Star/Curvature/Rounded-Rectangle are toolbar-selected (no single-key default).

Quality rules:
- Implement real, working interactions — do NOT stub, fake, or leave TODOs in the tools this
  phase is about. If you must defer something, say so explicitly at the end.
- TypeScript strict mode. No `any` in model or geometry types.
- Keep the app runnable at every step: `npm run dev` must start with no console errors.
- Match the existing file structure and naming conventions.
- At the end, output: (1) what you built, (2) how to test it by hand, (3) anything deferred.
```

---

## Prompt 0a — Foundation, part 1: substrate & model

> Paste the Reusable Preamble, then this. This prompt builds NO interactive tools — it builds the
> geometry library, the document model, serialization, and a test harness, and proves them with
> unit tests. Do not add UI or interactions yet.

```
Scaffold the project and build the model substrate ONLY. No canvas interactions, no tools yet —
this prompt ends with passing unit tests, not a usable app.

1. PROJECT SETUP
   - Scaffold Vite + React + TypeScript (strict mode) INTO THIS EXISTING repo `zesty-shapes`
     (README + docs/ already exist; add package.json, src/, and config — do not delete docs/).
   - Add dependencies: zustand, immer, nanoid, bezier-js. Dev: vitest.
     (Reserve polygon-clipping/martinez for a later phase — don't add yet.)
   - Feature-first structure:
     src/model/{types.ts, document.ts, serialize.ts, defs.ts, nodes/}
     src/geometry/{vec2.ts, matrix.ts, bezier.ts, bbox.ts, hittest.ts, pathData.ts, shapes.ts}
     src/store/{...}  src/rendering/{...}  src/tools/{...}  src/snapping/{...}  src/ui/{...}
     (create these dirs; 0b fills the runtime ones.)

2. GEOMETRY LIBRARY (pure functions, unit-testable, no third-party types leaking out)
   - vec2: add, sub, scale, dot, length, normalize, lerp, angle, rotate ({x,y}).
   - matrix: affine 6-tuple; multiply, invert, compose (translate/scale/rotate), applyToPoint,
     decompose (extract translation/rotation/scale for handles). Fix multiply order and document
     it (column-vector, M*point). Emits `matrix(a,b,c,d,e,f)`.
   - bezier (wrap bezier-js behind our own thin API): pointAt(t), splitAt(t), tight bounding box
     (via derivative roots, not control hull), length, nearestT(point).
   - bbox: node-local bbox, world bbox (transform-applied), union bbox.
   - hittest: point-in-fill (nonzero/evenodd), distance-to-stroke with tolerance,
     point-near-anchor (screen-px tolerance), rect-intersects-path (marquee).
   - pathData: subpaths -> SVG `d` string AND a tolerant parser `d` -> subpaths. Round-trip test
     it. This is the bridge between model, rendering, and export.
   - shapes: rectToPath, ellipseToPath (4-cubic arcs, kappa 0.5523), polygonToPath, starToPath.

3. DOCUMENT MODEL (src/model/types.ts is the most important file)
   - NodeId = nanoid string. BaseNode { id, type, name, parent, transform (6-tuple),
     style, opacity, blendMode, locked, hidden, clip?:NodeId }.  (clip reserved for masks.)
   - Shape nodes carry typed params AND a toPath(): RectNode{x,y,w,h,rx,ry},
     EllipseNode{cx,cy,rx,ry}, PolygonNode, StarNode, LineNode. PathNode{subpaths:SubPath[]}.
     GroupNode{ isLayer?, children }. RESERVE a TextNode kind (id/params placeholder) even though
     Type ships in a later phase — text bbox needs font measurement, so reserving the variant now
     avoids touching types.ts + bbox + NodeView + serialize + hittest all at once later.
   - Document factory carries `artboards: Artboard[]` from the start (Artboard{id,name,x,y,w,h}).
     Even with one default artboard, this must be a document-root concept (export-by-artboard
     later depends on it).
   - SubPath { id, closed, anchors: Anchor[] }.
     Anchor { id, point:Vec2, handleIn:Vec2|null, handleOut:Vec2|null,
              type:'corner'|'smooth'|'symmetric' }. Handles ABSOLUTE, in LOCAL space.
   - Style { fill:Paint|null, stroke:Paint|null, strokeWidth, strokeCap, strokeJoin,
             strokeDash, fillRule, widthProfile?:WidthStop[] }.
     Paint = {type:'solid', color:RGBA} | {type:'gradient', gradientType, stops, transform}.
     RESERVE widthProfile and gradient fields now even though only solid fill is implemented.
   - document.ts: factory + pure CRUD helpers (addNode, removeNode, updateNode, reparent,
     reorder). CONTRACTS: reparent/reorder keep `parent` and `children` in sync atomically;
     reparent PRESERVES world position by baking the transform delta between old and new parent.
   - serialize.ts: doc <-> JSON (ids preserved) AND doc -> SVG string emitted directly from the
     model (pathData + defs registry) — NOT via XMLSerializer on rendered DOM. localStorage
     save/load with autosave-ready API (0b wires the autosave trigger).
   - defs.ts: the defs registry (stable ids, dedupe, GC-on-delete) — see Preamble.

4. TEST HARNESS (vitest)
   - `npm run test` script. Write, at minimum:
     - pathData round-trip: subpaths -> `d` -> subpaths is identical for lines, cubics, closed
       and open paths.
     - matrix: multiply order, invert(compose(...)) == identity, decompose round-trip.
     - serialize round-trip: doc -> JSON -> doc preserves node/subpath/anchor ids and geometry.

ACCEPTANCE (0a):
- npm install succeeds; `npx tsc --noEmit` passes under strict mode.
- `npm run test` is green, including the pathData, matrix, and serialize round-trip tests.
- No interactive app is expected yet.
```

---

## Prompt 0b — Foundation, part 2: runtime & the two proving tools

> Paste the Reusable Preamble, then this. Feed it the current `src/` tree AND the contents of
> `src/model/types.ts` and the geometry function signatures from 0a. This prompt makes the app
> usable and is the acceptance gate for the whole foundation.

```
Build the runtime on top of the 0a substrate. Extend the existing model/geometry — do not
recreate them. Ship exactly two tools to prove every layer works end to end: a Rectangle tool
and a Selection tool.

4. STORE + UNDO/REDO
   - Zustand + Immer, sliced (document / selection / viewport / tool / ui). documentSlice is
     undoable; selection/viewport/tool/ui are not (except selection restored by structural
     commands).
   - store/history.ts: every mutation goes through applyCommand using produceWithPatches; push
     {patches, inversePatches, label}. undo=apply inverse, redo=apply forward.
   - Transaction API: beginTransaction(label) / commitTransaction() / cancelTransaction(). A
     drag mutates a preview and commits ONE combined patch on pointer-up (or renders preview in
     the overlay only and touches the model once at gesture end). Escape cancels.
   - store/commands.ts: semantic creators (addNode, deleteNodes, transformNodes, setStyle...).
     Structural commands (delete, group) capture and RESTORE selection on undo.
   - Wire the 0a localStorage save/load into autosave (debounced) + load-on-boot.

5. COORDINATE SYSTEM + VIEWPORT
   - viewportSlice: pan {tx,ty} + uniform zoom. Apply via a root document <g transform>.
   - screenToDoc(p) = (p - pan)/zoom; docToScreen(p) = p*zoom + pan.
   - worldTransform(nodeId): memoized product of ALL ancestor group transforms × the node's own
     transform. Object->local = invert(worldTransform). Everything (hit-testing, anchor editing,
     handle drags) goes through these — NO ad-hoc per-node inversion, NO ancestor-agnostic math.
   - Viewport.tsx captures raw pointer/wheel events ONCE and hands tools a normalized
     ToolPointerEvent {docPoint, screenPoint, snappedPoint, modifiers, hitNode, deltaFromDown}.
   - Pan: Space-drag and middle-drag. Zoom: wheel, zoom toward cursor (keep doc point under
     cursor fixed). Pan/zoom must update ONLY the root <g> transform — scene object components
     must NOT re-render on pan/zoom (rely on Zustand selectors).

6. RENDERING
   - DocumentSvg renders artboard(s) + scene <g>. NodeView is React.memo, keyed by node id,
     switches on kind, renders native <rect>/<ellipse>/... for parametric shapes and <path>
     for PathNode, applies each node's own transform (nesting composes naturally via <g>).
     Overlay is a SEPARATE screen-space SVG: selection bounding box + 8px handles that stay
     constant size at any zoom, plus the marquee rectangle.

7. TOOL FRAMEWORK
   - tools/types.ts: Tool interface + ToolContext (doc/selection/viewport/overlay/snapping/
     hitTest APIs) + ToolPointerEvent. behaviors/: DragBehavior (threshold + transaction),
     MarqueeBehavior.
   - ToolManager: active-tool dispatch, registry (id + shortcut -> Tool, per the authoritative
     shortcut map), global modifiers (Space=temp pan, Esc=cancel, Shift=constrain/add).
   - Selection tool (V): click to select (DOM hit-test), Shift-click to add, marquee to select,
     drag to move (updates transform e,f; one undo step), Delete/Backspace to delete,
     Cmd/Ctrl+Z / Shift+Cmd+Z undo/redo.
   - Rectangle tool (M): click-drag to create a RectNode; Shift = square; Alt = from center.

8. SNAPPING (interface + minimal impls)
   - Snapper interface { snap(point, ctx): {point, guides} | null }. Implement GridSnapper and
     AngleSnapper (shift-constrain). Thresholds in SCREEN pixels, divided by zoom. The
     normalized snappedPoint runs through enabled snappers; guides render in the overlay.
   - RESERVE a SnapProvider seam for future object/anchor "smart guide" snapping (not implemented
     now) so the "snapping" surface can grow without reworking the interface.

9. MINIMAL UI: a left Toolbar with the two tools, a zoom indicator, and a "Export SVG" button
   that downloads serialize->SVG (model-emitted). No color/layers panels yet.

ACCEPTANCE (foundation gate — must all work before we proceed):
- Draw several rectangles; select/multi-select/move/delete them.
- Pan (space-drag) and zoom-to-cursor feel correct; objects stay crisp; no re-render jank.
- Undo/redo across create, move, delete — each drag is exactly one undo step; undo of a delete
  restores both the nodes AND the prior selection.
- Export SVG (model-emitted) downloads a file that opens correctly in a browser with the
  rectangles intact; reload the page and the document is restored from localStorage.
- npm run dev starts clean; `npx tsc --noEmit` and `npm run test` pass.
```

---

## Prompt 1 — Selection & basic shapes

```
Add the remaining shape tools and complete Selection. Reuse DragBehavior/MarqueeBehavior and
the existing overlay — do not fork the interaction code.
- Shape tools: Rounded Rectangle (SAME RectNode with rx,ry + a live radius handle — NOT a new
  node type), Ellipse (L), Polygon (sides via a modal/drag), Star (points + inner radius),
  Line (\). Shift constrains; Alt draws from center. Use the parametric node types + native SVG
  rendering already defined; move by transform, never by mutating params.
- Selection polish: Shift-add/remove, marquee intersect vs contain, double-click to enter a
  group, arrow-key nudge (Shift = larger step), copy/paste/duplicate (Alt-drag duplicate).
- Establish the transform bounding-box overlay (8 handles + rotation affordance) shown for the
  current selection — even if scale/rotate interactions come next phase, the visual is here.
ACCEPTANCE: every shape draws correctly, exports to correct SVG, and is selectable/movable/
deletable with correct undo grouping.
```

## Prompt 2 — Transforms, layers & structure

```
- Scale (S) and Rotate (R): drag bounding-box handles; use matrix decompose/compose; Shift
  constrains aspect/angle; Alt = about center; rotation handle outside the box. Live preview,
  one undo step per gesture. Composes into the node transform.
- Align & Distribute panel: left/center/right/top/middle/bottom + distribute, relative to
  selection bounds (uses union bbox).
- Layers panel: reflects the node tree; reorder via drag (z-order = children array order),
  group/ungroup (Cmd+G / Shift+Cmd+G), lock/hide per node (inherits to children), rename,
  nested groups, select-from-panel synced with canvas selection.
- Group/ungroup/reparent MUST preserve world position (bake the transform delta; ungroup pushes
  the group transform into each child) — use the worldTransform helper.
ACCEPTANCE: transforms are accurate and reversible; rotating a group then editing a child keeps
positions correct; layers panel and canvas stay in sync; grouping/reordering/lock/hide all work
and export correctly; ungrouping never moves anything on screen.
```

## Prompt 3 — Paths & anchors (the hardest group)

```
This validates the Anchor schema and the world-transform pipeline. Reuse the existing
SubPath/Anchor model; do not change it.
- Direct Selection (A): select/move individual anchors and bezier handles THROUGH the node's
  worldTransform (so anchors of rotated/nested paths track the cursor exactly); break/join handle
  symmetry (Alt drag = independent handles); marquee-select anchors; convert anchor type
  (corner<->smooth). Overlay draws anchors + handle lines in screen space.
- Pen (P): click = corner anchor, click-drag = smooth anchor with handles, close path on first
  anchor, Alt to break handle, add/delete anchor on an existing path, continue an open path.
- Curvature: click to drop points that auto-smooth into a continuous curve; double-click a
  point toggles corner/smooth.
- Pencil (N): freehand; fit the input stream to a bezier path (use bezier nearestT/length +
  a Ramer-Douglas-Peucker or Schneider-style fit).
- "Convert to Path" command (shape -> PathNode via toPath(), PRESERVING the node transform).
  Pen/Direct-Select auto-convert parametric shapes on edit.
- Scissors: split a path at a clicked point (bezier splitAt).
ACCEPTANCE: draw a curve with Pen, reshape it with Direct Selection, convert a rectangle to a
path and edit its anchors, edit anchors of a ROTATED/grouped path and have handles land on the
visible geometry, and export correct SVG throughout.
```

## Prompt 4 — Color & appearance

```
- Fill/Stroke UI: swatches + color picker (HSB/RGB/HEX), opacity, stroke width/cap/join/dash,
  no-fill/no-stroke, swap fill/stroke.
- Eyedropper (I): sample fill/stroke/appearance from another object and apply to selection.
- Gradient (G): linear/radial with editable stops, on-canvas gradient annotator to set
  direction/position (writes gradient.transform), rendered via SVG <linearGradient>/
  <radialGradient> allocated through the defs registry (stable ids, deduped, GC'd on delete).
- Variable stroke Width tool (Shift+W): edit the reserved widthProfile at points along a path.
  NOTE the dependency: a TRUE outlined variable-width stroke is offset-curve/boolean-adjacent
  work that does not exist until Prompt 5. For THIS phase, ship the SVG stroke-width
  approximation (editable widthProfile + rendered approximation) and explicitly defer the real
  filled-outline geometry to after Prompt 5's boolean/offset engine lands. Do not silently stub
  the outline — state the deferral.
ACCEPTANCE: solids and gradients render and export correctly; gradient defs are unique and are
removed when their last user is deleted; eyedropper transfers appearance; the width tool edits
and renders the approximate profile, with the true outline explicitly deferred.
```

## Prompt 5 — Boolean & path operations

```
Now add the boolean/path engine. Add polygon-clipping (or martinez) behind a geometry/boolean.ts
wrapper — no third-party types in the model.
- Pathfinder panel: Unite, Minus Front, Intersect, Exclude, Divide, Trim, Merge. Operate on
  PathNodes (auto-convert shapes first). Output compound paths (multiple subpaths + correct
  fillRule) using the existing SubPath[] model.
- Add a stroke-outlining / offset primitive here; retrofit Prompt 4's variable-width tool to
  emit a real filled outline shape that survives export.
- Shape Builder (Shift+M): interactively merge/subtract overlapping regions by
  click/drag/Alt-click.
- Knife: freehand cut across shapes into separate closed paths. Eraser (Shift+E): remove path
  regions.
ACCEPTANCE: combine and subtract overlapping shapes into correct compound paths that export as
valid SVG with correct fill-rule; variable-width strokes now export as filled outlines.
```

## Prompt 6 — Text & attribute selection

```
Implement the reserved TextNode kind.
- Type (T): point text + area text; font family/size/weight, kerning, tracking, leading,
  alignment; edit in place. Convert text to outlines (-> PathNodes). Text bbox uses DOM/font
  measurement; wire TextNode into NodeView, bbox, hittest, and serialize.
- Type on a Path: flow text along any path (uses bezier nearestT/length); Vertical Type.
- Magic Wand (Y): select objects sharing fill/stroke/opacity within a tolerance.
- Lasso (Q): freehand-select objects/anchors (point-in-polygon test).
ACCEPTANCE: text renders/edits/exports (as text and as outlines); type-on-path follows curves;
wand and lasso select correctly.
```

## Prompt 7 — Document features & export

```
- Artboards (Shift+O): create/resize/duplicate/delete multiple artboards on the document-root
  `artboards` array reserved in 0a; per-artboard bounds.
- Export: SVG (already, model-emitted), PNG + JPG (render document SVG to a canvas via
  Image+drawImage, toBlob), PDF (svg2pdf.js + jsPDF). Export selection, artboard, or whole
  document; scale factor options; export multiple assets at once.
ACCEPTANCE: each format exports a correct file; gradients and text survive PNG/PDF export;
multi-artboard export produces one asset per artboard.
```

## Prompt 8 — Stretch tools (optional, only if the above is solid)

```
Blend (W), Gradient Mesh (U), Symbol Sprayer (Shift+S), Paintbrush (B) / Blob Brush (Shift+B).
Mesh and brushes may justify enabling the reserved Canvas layer for raster-heavy previews.
Treat as independent add-ons; do not destabilize the core.
```

---

## Prompting best-practices that make Fable 5 deliver (apply to all prompts)

- **Always prepend the Reusable Preamble.** It's the anti-drift mechanism — it re-asserts the
  invariants so a later generation can't quietly switch to a nested tree or canvas rendering.
- **Constrain scope explicitly** ("build ONLY…", "do not add other tools"). Over-eager scope is
  the top cause of shallow, buggy output.
- **Give acceptance criteria as concrete manual tests**, not adjectives. "Each drag is one undo
  step" beats "good undo support."
- **Forbid stubs in the phase's target tools.** Allow — and require a list of — explicit
  deferrals at the end instead of silent TODOs.
- **Keep it runnable every phase** (`npm run dev` clean). Never let a phase leave the app broken.
- **Feed the model the current CONTRACTS, not just the file tree.** At the start of phases 0b+,
  paste `tree src` AND the actual interfaces the phase builds against: `src/model/types.ts`, the
  `Tool` / `ToolContext` / `ToolPointerEvent` interfaces, and the store/command API surface. A
  filename list tells the model a file exists; it does not tell it the function signatures, so it
  will otherwise invent plausible-but-wrong APIs. This is the strongest anti-drift lever after
  the Preamble.
- **One phase per conversation** where practical, so context stays focused; carry state forward
  via the preamble + pasted contracts, not by relying on the model's memory.

---

## Verification (how to confirm each phase actually works)

After each phase, in the `zesty-shapes` repo:
1. `npm install` (first time) then `npm run dev` — must start with **zero** console errors.
2. `npx tsc --noEmit` — TypeScript strict must pass. `npm run test` — vitest must be green.
3. Run that phase's **ACCEPTANCE** checklist by hand in the browser.
4. **Export visual-fidelity check:** export SVG and open it in a browser — geometry, color, and
   text must look identical to the editor. (This views the export; it does not re-import it — we
   export only, SVG *import* is descoped.)
5. **JSON round-trip check (the real round-trip):** serialize the document to JSON and
   deserialize it; the node map must be identical — every node, subpath, and anchor id preserved,
   geometry unchanged. Reload the page and confirm localStorage restores the same document.
6. **Undo stress test:** perform 10 mixed operations, undo all the way to empty, redo all the
   way back — the document must return to the exact same state; undo of a delete restores the
   prior selection.
7. Only advance to the next phase once the current one passes.

The foundation (Prompts 0a + 0b) deserves the most scrutiny. Beyond the gate above, specifically
verify the invariants most likely to be silently wrong:
- **(a)** pan/zoom does not re-render scene objects (check React DevTools highlight-updates).
- **(b)** one drag = one undo entry.
- **(c)** `pathData` round-trips `d` <-> subpaths (unit test).
- **(d)** move a group, then ungroup — children keep their exact world positions.
- **(e)** rotate a rect, then Direct-Select its anchors (Prompt 3) — handles land on the visible
  geometry, proving the worldTransform pipeline.
- **(f)** convert a rounded rect to a path — pixel-identical before/after (toPath fidelity).
- **(g)** gradient defs (Prompt 4) are unique and removed when the last user is deleted.
These are the ones that are painful to fix later.
```
