# Session handoff — zesty-shapes

Last updated: 2026-07-09

Pick-up notes for the next session. What we're building, what's done, what's next.
The ranked feature plan lives in [`docs/ROADMAP.md`](./ROADMAP.md) — read that first
for the "why" behind the priorities.

---

## What we're doing

Building out **zesty-shapes**, an Illustrator-like vector editor (React + Vite +
TypeScript), by porting the most battle-tested Illustrator features in
value-per-effort order. Feature selection and ranking are in
[`docs/ROADMAP.md`](./ROADMAP.md).

Architecture invariants that every change must respect:
- Normalized plain-JSON id-keyed node map; React-rendered SVG + separate screen-space overlay.
- Three coordinate spaces (`screenToDoc` / `docToScreen`), memoized `worldTransform`.
- **POSITIONING RULE**: shape params are local geometry only; the node transform is the sole placement mechanism.
- Parametric shapes expose `toPath()`; the defs registry owns shared SVG defs (gradients, clipPaths, filters, patterns).
- Zustand + Immer **patch-based undo**; one gesture = one transaction = one undo step.
- Model-emitted SVG export + JSON round-trip are the source of truth (never serialize the React DOM).
- Shared `Tool` interface + `ToolManager`; commands are `cmdXxx(store, …)` functions in `src/store/`.

Quality bar: no stubs/TODOs, TS strict (no `any` in model/geometry), zero console
errors in the running app, every feature covered by tests.

---

## What's complete

### The five essentials — PR #13 (`feat/il-essentials` → `main`, open)

https://github.com/tgardella/zesty-shapes/pull/13

All wired model → render → export → menus, tested, and verified live in-browser with
zero console errors.

1. **Clipping mask** — reserved `GroupNode.clip` → live `<clipPath>`. `src/store/clipCommands.ts` (make/release), render in `NodeView`, export in `serialize.ts`, Object menu + ⌘7 / ⌥⌘7 + context menu.
2. **Reflect & Shear** — pure `reflectDocTransform` / `shearDocTransform` in `src/tools/behaviors/TransformHandleBehavior.ts`; `ReflectTool` (O) + `ShearTool`, toolbar-grouped with Scale/Rotate.
3. **Select Same** — `src/store/selectSame.ts` (fill / stroke / stroke weight / opacity); Edit menu + context menu. Pure selection, no undo step.
4. **Offset Path + Outline Stroke** — `offsetRegions` + `cmdOffsetPath` in `src/store/booleanCommands.ts` (Outline Stroke already existed, now surfaced). Object menu.
5. **Drop Shadow** — `DropShadow` on `Style`; per-node `<feDropShadow>` filter (canvas + export); Appearance panel row. Non-destructive, JSON round-trips.

Status: **384 tests pass** (46 files), `tsc --noEmit` clean, production build clean.

### Docs (untracked working files, to fold into the NEXT PR — not #13)

- `docs/ROADMAP.md` — ranked feature list, current state, and the recommended next-five.
- `docs/HANDOFF.md` — this file.

Both are intentionally left out of PR #13's history. They should ride along in the
next feature branch/PR.

---

## Next steps

1. **Land PR #13.** Review + merge `feat/il-essentials` into `main`. Nothing blocks it.
2. **Start the next branch off updated `main`** (e.g. `feat/appearance-stack`). Fold `docs/ROADMAP.md` + `docs/HANDOFF.md` into that branch's first commit.
3. **Build the recommended next-five, in order** (see ROADMAP → "If I built five things after the shipped set"):
   1. **Multiple fills & strokes** — generalize `style` into an ordered *appearance stack* (per-item fill/stroke/effect + blend + opacity). Biggest structural upgrade; Drop Shadow already gestures at it. Plan the model change carefully — it touches `Style`, `AppearancePanel`, `NodeView`, `serialize.ts`, and every `cmdSetStyle` path.
   2. **Swatches panel** — named reusable color/gradient/pattern swatches; small persisted palette store. On-ramp for Recolor + Patterns.
   3. **Recolor Artwork** — remap distinct colors across a selection in one undo step.
   4. **Pattern fills** — tileable `<pattern>` swatches via the defs registry (same machinery as gradients).
   5. **Live Corners** — parametric per-corner radius on anchors; renders through `toPath()`.

### Recommended workflow for the next feature (mirror what worked here)
- Read the target files first (model types, the relevant render/export/menu paths, an analogous existing command to copy).
- For a big one like the appearance stack, consider `EnterPlanMode` and confirm the model shape before writing code.
- One `cmdXxx` command per feature in `src/store/`, one undo step, `{ selectAfter }` for structural ops.
- Keep canvas render (`NodeView`) and SVG export (`serialize.ts`) in lockstep — their headers require parity.
- New tools: register in `src/tools/index.ts`, group in `src/ui/toolbarConfig.ts`, add an icon in `src/ui/Toolbar.tsx`.
- Add tests per feature; run `npx vitest run` + `npx tsc --noEmit` + `npm run build`; smoke-test the live app for zero console errors (`window.__editorStore` is exposed in dev for driving state).

---

## Quick reference

- Tests: `npx vitest run` · Typecheck: `npx tsc --noEmit` · Build: `npm run build` · Dev: `npm run dev`
- Commands live in `src/store/*Commands.ts`; menus in `src/ui/MenuBar.tsx` + `src/ui/CanvasContextMenu.tsx`.
- Render: `src/rendering/NodeView.tsx` (+ `Defs.tsx`); export: `src/model/serialize.ts`.
- Model types: `src/model/types.ts`; node factories + `toSubPaths` / `toPath`: `src/model/nodes/index.ts`.
- Transform gestures: `src/tools/behaviors/TransformHandleBehavior.ts`.
