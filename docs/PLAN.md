# Plan: A Rock-Solid Prompt Sequence for Building a Vector Editor with Fable 5

## Context

You want to build a simplified-but-genuinely-usable Illustrator-like vector graphics
editor and have **Fable 5** do the actual coding. The goal of *this* document is not to
build the tool — it's to produce the **prompts** you'll paste into Fable 5 to get the best
possible result.

Decisions locked in with you:
- **Stack:** React + Vite + TypeScript (multi-file project).
- **Approach:** a **phased prompt sequence** — one foundation prompt, then follow-up prompts
  that add tool groups incrementally.
- **Bar:** genuinely usable — real interactions, undo/redo, keyboard shortcuts, snapping.
- **Starting point:** `/Users/tony/dev/illustrator` is empty (true greenfield).

**Why phased, not one mega-prompt:** the full feature list is ~40 tools. No single generation
produces all of that well. The failure mode of one-shotting is that the model makes convenient
early choices (nested-tree document, canvas rendering, per-tool coordinate math) that make the
*hard* tools (Pen, Pathfinder, Direct Selection) require a rewrite. The fix is to spend the
first prompt entirely on **architecture that is expensive to reverse**, prove it with two
trivial tools, then add everything else additively.

**The single most important idea:** Prompt 1 ships *no interesting tools*. It ships the
document model, rendering pipeline, coordinate system, tool framework, undo system, and
geometry library — then proves all of it end-to-end with just a Rectangle tool and a Selection
tool. If Prompt 1 is right, the other ~40 tools are additions, not rewrites.

---

## How to use this plan

1. Each phase below is a **copy-ready prompt**. Paste **Prompt 0 (Foundation)** first and let
   Fable 5 complete + verify it before moving on.
2. Prepend the **Reusable Preamble** (below) to *every* phase prompt. It carries the
   architecture invariants forward so later prompts don't drift.
3. After each phase, run the **verification checklist** for that phase before continuing.
4. Only advance when the prior phase runs. Later phases assume the substrate the earlier ones
   built.

The prompts themselves are the deliverable. The rest of this file (rationale, ordering,
verification) is there so you know *why* each prompt says what it says and can adjust scope.

---

## The five hard-to-reverse decisions baked into Prompt 0

These come from an architecture review and are the reason Prompt 0 looks the way it does:

1. **Normalized, id-keyed node map** (`Record<NodeId, SceneNode>` + `children: NodeId[]`) as
   the document source of truth — *not* a nested object tree. O(1) lookup, reparenting, and
   undo diffs.
2. **Anchor schema:** absolute handle coordinates, handles stored *on* the anchor, stable ids
   on anchors and subpaths, geometry in **local space** with `transform` applied at render.
   Pen, Curvature, Direct Selection, Scissors, Knife, variable-width, and type-on-path all
   depend on this.
3. **Parametric shapes with a `toPath()` derivation + explicit "Convert to Path"** — shapes stay
   editable (live corner radius, etc.) but every deep tool gets a uniform path substrate.
4. **Patch-based command undo with transaction coalescing** (one drag = one undo step), a
   plain-JSON document, and selection kept largely *outside* history.
5. **One normalized pointer-event pipeline + screen/doc/local coordinate functions + a
   screen-space overlay** so 40 tools never re-derive coordinate or hit-testing math.

Rendering choice: **SVG-DOM scene graph** (React renders the document as SVG; a *separate*
screen-space SVG renders selection handles/marquee/guides). This makes vector export exact and
free, gives browser-native hit-testing, and matches React's declarative model. Canvas is
reserved only for future raster-heavy stretch features (mesh, brushes).

---

## Reusable Preamble (prepend to EVERY phase prompt)

```
You are building a simplified but genuinely usable Illustrator-like vector graphics editor.
Stack: React + Vite + TypeScript. This is a phased build; honor the architecture already
established and extend it additively — do not restructure existing foundations.

Non-negotiable architecture invariants:
- Document is the source of truth: a normalized, plain-JSON, id-keyed node map
  `nodes: Record<NodeId, SceneNode>` plus tree order via `children: NodeId[]`. No class
  instances, functions, or Maps in the document — geometry helpers are pure free functions.
- Rendering: the document is an SVG DOM tree (React-rendered). A SEPARATE, screen-space SVG
  overlay renders selection handles, marquee, and snap guides. Overlay graphics are constant
  screen size at any zoom. Never bake pan/zoom into individual objects — only the root
  document <g transform> pans/zooms.
- Three explicit coordinate spaces (screen / document / local). All coordinate conversion goes
  through shared screenToDoc() / docToScreen() helpers. Anchor geometry is stored in LOCAL
  space; each node's affine transform (SVG 6-tuple [a,b,c,d,e,f]) is applied at render.
- Shapes are parametric (rect/ellipse/polygon/star/line keep their params) and implement
  toPath(); "Convert to Path" replaces a shape with an editable PathNode. Deep tools operate on
  PathNodes and auto-convert inputs.
- Anchors: absolute handle coords, handles stored on the anchor (handleIn/handleOut), stable
  ids on anchors and subpaths, type = corner|smooth|symmetric.
- State: Zustand + Immer, sliced (document / selection / viewport / tool / ui). Undo/redo is
  patch-based (Immer produceWithPatches) with semantic labels and TRANSACTION COALESCING — one
  drag gesture is ONE undo step. Bare selection changes do not create undo entries; structural
  commands restore selection on undo. Viewport is never undoable.
- Tools implement a shared Tool interface (onPointerDown/Move/Up, onKeyDown, cursor, shortcut)
  and receive a normalized ToolPointerEvent already carrying document-space point, screen
  point, snapped point, modifiers, top-hit node, and delta-from-down. Tools issue commands via
  the store API and NEVER write raw state. A central ToolManager handles active-tool dispatch,
  global modifiers (Space=pan, Esc=cancel gesture, Shift=constrain/add), and the shortcut map.

Quality rules:
- Implement real, working interactions — do NOT stub, fake, or leave TODOs in the tools this
  phase is about. If you must defer something, say so explicitly at the end.
- TypeScript strict mode. No `any` in model or geometry types.
- Keep the app runnable at every step: `npm run dev` must start with no console errors.
- Match the existing file structure and naming conventions.
- At the end, output: (1) what you built, (2) how to test it by hand, (3) anything deferred.
```

---

## Prompt 0 — Foundation (the load-bearing prompt)

> Paste the Reusable Preamble, then this. Expect this to be the largest single generation.
> Do not add more tools than asked — the point is a proven substrate, not features.

```
Scaffold the project and build ONLY the foundation. Ship exactly two tools to prove every layer
works end to end: a Rectangle tool and a Selection tool.

1. PROJECT SETUP
   - Vite + React + TypeScript, strict mode. Add dependencies: zustand, immer, nanoid,
     bezier-js. (Reserve polygon-clipping/martinez for a later phase — don't add yet.)
   - Feature-first structure:
     src/model/{types.ts, document.ts, serialize.ts, nodes/}
     src/geometry/{vec2.ts, matrix.ts, bezier.ts, bbox.ts, hittest.ts, pathData.ts, shapes.ts}
     src/store/{useStore.ts, documentSlice.ts, selectionSlice.ts, viewportSlice.ts,
               toolSlice.ts, uiSlice.ts, history.ts, commands.ts}
     src/rendering/{Viewport.tsx, DocumentSvg.tsx, NodeView.tsx, Overlay.tsx}
     src/tools/{ToolManager.ts, types.ts, registry.ts, behaviors/, select/, shapes/}
     src/snapping/{Snapper.ts, grid.ts, angle.ts}
     src/ui/{App.tsx, panels/Toolbar.tsx}

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
     style, opacity, blendMode, locked, hidden }.
   - Shape nodes carry typed params AND a toPath(): RectNode{x,y,w,h,rx,ry},
     EllipseNode{cx,cy,rx,ry}, PolygonNode, StarNode, LineNode. PathNode{subpaths:SubPath[]}.
     GroupNode{ isLayer?, children }.
   - SubPath { id, closed, anchors: Anchor[] }.
     Anchor { id, point:Vec2, handleIn:Vec2|null, handleOut:Vec2|null,
              type:'corner'|'smooth'|'symmetric' }. Handles ABSOLUTE, in LOCAL space.
   - Style { fill:Paint|null, stroke:Paint|null, strokeWidth, strokeCap, strokeJoin,
             strokeDash, fillRule, widthProfile?:WidthStop[] }.
     Paint = {type:'solid', color:RGBA} | {type:'gradient', gradientType, stops, transform}.
     RESERVE widthProfile and gradient fields now even though only solid fill is implemented.
   - document.ts: factory + pure CRUD helpers (addNode, removeNode, updateNode, reparent,
     reorder). serialize.ts: doc <-> JSON and doc -> SVG string (via XMLSerializer on rendered
     SVG, or by emitting `d` from pathData).

4. STORE + UNDO/REDO
   - Zustand + Immer, sliced as listed. documentSlice is undoable; selection/viewport/tool/ui
     are not (except selection restored by structural commands).
   - history.ts: every mutation goes through applyCommand using produceWithPatches; push
     {patches, inversePatches, label}. undo=apply inverse, redo=apply forward.
   - Transaction API: beginTransaction(label) / commitTransaction() / cancelTransaction(). A
     drag mutates a preview and commits ONE combined patch on pointer-up (or renders preview in
     the overlay only and touches the model once at gesture end). Escape cancels.
   - commands.ts: semantic creators (addNode, deleteNodes, transformNodes, setStyle...).

5. COORDINATE SYSTEM + VIEWPORT
   - viewportSlice: pan {tx,ty} + uniform zoom. Apply via a root document <g transform>.
   - screenToDoc(p) = (p - pan)/zoom; docToScreen(p) = p*zoom + pan. Object->local via node
     inverse transform. Everything uses these — no ad-hoc math.
   - Viewport.tsx captures raw pointer/wheel events ONCE and hands tools a normalized
     ToolPointerEvent {docPoint, screenPoint, snappedPoint, modifiers, hitNode, deltaFromDown}.
   - Pan: Space-drag and middle-drag. Zoom: wheel, zoom toward cursor (keep doc point under
     cursor fixed). Pan/zoom must update ONLY the root <g> transform — scene object components
     must NOT re-render on pan/zoom (rely on Zustand selectors).

6. RENDERING
   - DocumentSvg renders artboard(s) + scene <g>. NodeView is React.memo, keyed by node id,
     switches on kind, renders native <rect>/<ellipse>/... for parametric shapes and <path>
     for PathNode. Overlay is a SEPARATE screen-space SVG: selection bounding box + 8px handles
     that stay constant size at any zoom, plus the marquee rectangle.

7. TOOL FRAMEWORK
   - types.ts: Tool interface + ToolContext (doc/selection/viewport/overlay/snapping/hitTest
     APIs) + ToolPointerEvent. behaviors/: DragBehavior (threshold + transaction),
     MarqueeBehavior.
   - ToolManager: active-tool dispatch, registry (id + shortcut -> Tool), global modifiers
     (Space=temp pan, Esc=cancel, Shift=constrain/add-to-selection).
   - Selection tool (V): click to select (DOM hit-test), Shift-click to add, marquee to select,
     drag to move (one undo step), Delete/Backspace to delete, Cmd/Ctrl+Z / Shift+Cmd+Z undo/redo.
   - Rectangle tool (M or R for now): click-drag to create a RectNode; Shift = square;
     Alt = from center.

8. SNAPPING (interface + minimal impls)
   - Snapper interface { snap(point, ctx): {point, guides} | null }. Implement GridSnapper and
     AngleSnapper (shift-constrain). Thresholds in SCREEN pixels, divided by zoom. The
     normalized snappedPoint runs through enabled snappers; guides render in the overlay.

9. MINIMAL UI: a left Toolbar with the two tools, a zoom indicator, and a "Export SVG" button
   that downloads serialize->SVG. No color/layers panels yet.

ACCEPTANCE (must all work before we proceed):
- Draw several rectangles; select/multi-select/move/delete them.
- Pan (space-drag) and zoom-to-cursor feel correct; objects stay crisp; no re-render jank.
- Undo/redo across create, move, delete — each drag is exactly one undo step.
- Export SVG downloads a file that opens correctly in a browser with the rectangles intact.
- npm run dev starts clean; TypeScript strict passes.
```

---

## Prompt 1 — Selection & basic shapes

```
Add the remaining shape tools and complete Selection. Reuse DragBehavior/MarqueeBehavior and
the existing overlay — do not fork the interaction code.
- Shape tools: Rounded Rectangle, Ellipse (L), Polygon (sides via a modal/drag), Star
  (points + inner radius), Line (\). Shift constrains; Alt draws from center. Use the
  parametric node types + native SVG rendering already defined.
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
  one undo step per gesture.
- Align & Distribute panel: left/center/right/top/middle/bottom + distribute, relative to
  selection bounds (uses union bbox). 
- Layers panel: reflects the node tree; reorder via drag (z-order = children array order),
  group/ungroup (Cmd+G / Shift+Cmd+G), lock/hide per node (inherits to children), rename,
  nested groups, select-from-panel synced with canvas selection.
ACCEPTANCE: transforms are accurate and reversible; layers panel and canvas stay in sync;
grouping/reordering/lock/hide all work and export correctly.
```

## Prompt 3 — Paths & anchors (the hardest group)

```
This validates the Anchor schema. Reuse the existing SubPath/Anchor model; do not change it.
- Direct Selection (A): select/move individual anchors and bezier handles; break/join handle
  symmetry (Alt drag = independent handles); marquee-select anchors; convert anchor type
  (corner<->smooth). Overlay draws anchors + handle lines in screen space.
- Pen (P): click = corner anchor, click-drag = smooth anchor with handles, close path on first
  anchor, Alt to break handle, add/delete anchor on an existing path, continue an open path.
- Curvature: click to drop points that auto-smooth into a continuous curve; double-click a
  point toggles corner/smooth.
- Pencil (N): freehand; fit the input stream to a bezier path (use bezier nearestT/length +
  a Ramer-Douglas-Peucker or Schneider-style fit).
- "Convert to Path" command (shape -> PathNode via toPath()). Pen/Direct-Select auto-convert
  parametric shapes on edit.
- Scissors: split a path at a clicked point (bezier splitAt). 
ACCEPTANCE: draw a curve with Pen, reshape it with Direct Selection, convert a rectangle to a
path and edit its anchors, and export correct SVG throughout.
```

## Prompt 4 — Color & appearance

```
- Fill/Stroke UI: swatches + color picker (HSB/RGB/HEX), opacity, stroke width/cap/join/dash,
  no-fill/no-stroke, swap fill/stroke.
- Eyedropper (I): sample fill/stroke/appearance from another object and apply to selection.
- Gradient (G): linear/radial with editable stops, on-canvas gradient annotator to set
  direction/position (writes gradient.transform), rendered via SVG <linearGradient>/<radialGradient>.
- Variable stroke Width tool (Shift+W): edit the reserved widthProfile at points along a path;
  render as a filled outline shape (or SVG stroke approximation) and export accordingly.
ACCEPTANCE: solids and gradients render and export correctly; eyedropper transfers appearance;
variable width produces a calligraphic stroke that survives export.
```

## Prompt 5 — Boolean & path operations

```
Now add the boolean/path engine. Add polygon-clipping (or martinez) behind a geometry/boolean.ts
wrapper — no third-party types in the model.
- Pathfinder panel: Unite, Minus Front, Intersect, Exclude, Divide, Trim, Merge. Operate on
  PathNodes (auto-convert shapes first).
- Shape Builder (Shift+M): interactively merge/subtract overlapping regions by
  click/drag/Alt-click.
- Knife: freehand cut across shapes into separate closed paths. Eraser (Shift+E): remove path
  regions.
ACCEPTANCE: combine and subtract overlapping shapes into correct compound paths that export as
valid SVG with correct fill-rule.
```

## Prompt 6 — Text & attribute selection

```
- Type (T): point text + area text; font family/size/weight, kerning, tracking, leading,
  alignment; edit in place. Convert text to outlines (-> PathNodes).
- Type on a Path: flow text along any path (uses bezier nearestT/length); Vertical Type.
- Magic Wand (Y): select objects sharing fill/stroke/opacity within a tolerance.
- Lasso (Q): freehand-select objects/anchors (point-in-polygon test).
ACCEPTANCE: text renders/edits/exports (as text and as outlines); type-on-path follows curves;
wand and lasso select correctly.
```

## Prompt 7 — Document features & export

```
- Artboards (Shift+O): create/resize/duplicate/delete multiple artboards; per-artboard bounds.
- Export: SVG (already), PNG + JPG (render document SVG to a canvas via Image+drawImage,
  toBlob), PDF (svg2pdf.js + jsPDF). Export selection, artboard, or whole document; scale
  factor options; export multiple assets at once.
ACCEPTANCE: each format exports a correct file; multi-artboard export produces one asset per
artboard.
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
- **Feed the model the current file tree** at the start of phases 1+ (paste `tree src` or the
  file list) so it extends rather than re-creates.
- **One phase per conversation** where practical, so context stays focused; carry state forward
  via the preamble + pasted file tree, not by relying on the model's memory.

---

## Verification (how to confirm each phase actually works)

After each phase, in `/Users/tony/dev/illustrator`:
1. `npm install` (first time) then `npm run dev` — must start with **zero** console errors.
2. `npx tsc --noEmit` — TypeScript strict must pass.
3. Run that phase's **ACCEPTANCE** checklist by hand in the browser.
4. **Export round-trip:** export SVG and reopen it in a browser — geometry, color, and text
   must survive. This is the truest test that the model is honest, because the exported SVG *is*
   the document.
5. **Undo stress test:** perform 10 mixed operations, undo all the way to empty, redo all the
   way back — the document must return to the exact same state.
6. Only advance to the next phase once the current one passes.

The foundation (Prompt 0) deserves the most scrutiny: specifically verify (a) pan/zoom does not
re-render scene objects (check React DevTools highlight-updates), (b) one drag = one undo entry,
and (c) `pathData` round-trips `d` <-> subpaths. These three are the ones that are painful to fix
later.
```
