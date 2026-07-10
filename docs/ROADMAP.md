# Battle-tested Illustrator moves, ranked for zesty-shapes

The most-used, most-proven Illustrator features, mapped against what zesty-shapes
already has and ranked by daily-use value ÷ build cost ÷ architecture fit. This is
the source of truth that replaces the earlier one-off artifact link.

Ranking axes:
- **Use** — how often working illustrators actually reach for it (daily / weekly / niche).
- **Effort** — build cost against our architecture (S / M / L).
- **Fit** — how cleanly it lands on the normalized node map + parametric-shape + patch-undo model.

---

## Foundation (already shipped)

The engine these features build on is already in place:

- Normalized id-keyed node map; React-rendered SVG + screen-space overlay.
- Three coordinate spaces (`screenToDoc` / `docToScreen`) with memoized `worldTransform`.
- Parametric shapes with `toPath()`; the POSITIONING RULE (transform is the sole placement).
- Zustand + Immer patch-based undo with transaction coalescing (one gesture = one undo step).
- Pen / Pencil / Curvature, Width tool, Shape Builder, Knife, Eraser, Blend, Gradient Mesh.
- Pathfinder (Unite / Minus Front / Intersect / Exclude / Divide / Trim / Merge), Outline Stroke.
- Symbols + Symbolism tools, Artboards, Layers, gradients/defs registry, SVG export + JSON round-trip.

---

## ✅ Shipped — "the five essentials" (PR #13)

The first five recommendations below are now built, tested, and merged-ready. Kept
here for the record; details in the PR.

| Feature | Use | Effort | What it does |
|---|---|---|---|
| **Clipping mask** | Daily | M | Topmost object's silhouette clips the rest; live `<clipPath>`, make/release, ⌘7 / ⌥⌘7. |
| **Reflect & Shear** | Daily | S | Mirror + skew transform tools on the existing gesture pipeline. |
| **Select Same** | Daily | S | Select all objects with the same fill / stroke / weight / opacity. |
| **Offset Path + Outline Stroke** | Weekly | M | Grow/shrink a path; convert a stroke to a filled outline. |
| **Drop Shadow** | Daily | M | Non-destructive live `<feDropShadow>` filter, editable in the Appearance panel. |

---

## 01 · Quick wins (next up)

Small builds, high everyday payoff.

- **Swatches panel** — *Use: daily · Effort: S · Fit: high.* Named, reusable color/gradient/pattern swatches. Sits on the existing paint model; a small persisted palette store. Pairs naturally with Recolor Artwork.
- **Live Corners** — *Use: weekly · Effort: M · Fit: high.* Drag a widget to round/bevel/invert corners on any path anchor. Parametric per-corner radius on the anchor; renders through `toPath()`.
- **Isolation-mode polish / Group select depth** — *Use: daily · Effort: S.* Already have group isolation; add breadcrumb + double-click depth cues.

## 02 · High-impact (the core of a "finished" tool)

Bigger, but these are what make artwork look and feel professional.

- **Multiple fills & strokes** — *Use: daily · Effort: L · Fit: medium.* Generalize `style` from one fill/stroke into an ordered **appearance stack** (per-item fill/stroke/effect, blend, opacity). Unlocks stacked strokes, inner glows, and is the substrate Drop Shadow already hints at. The single largest "grown-up app" upgrade.
- **Recolor Artwork** — *Use: weekly · Effort: L · Fit: high.* Remap all colors in a selection through a harmony wheel / palette. Reads distinct colors off the node map, applies a color map in one undo step. Huge with Swatches.
- **Pattern fills** — *Use: weekly · Effort: M · Fit: high.* Tileable pattern swatches emitted as `<pattern>` in the defs registry (same machinery as gradients).
- **Gaussian Blur / more live effects** — *Use: weekly · Effort: S.* Once Drop Shadow's filter path exists, blur/glow are cheap siblings.

## 03 · Bigger bets (differentiators)

High ceiling, real engineering.

- **Live Paint** — *Use: niche→weekly · Effort: L.* Paint the regions formed by overlapping strokes as if they were flat fills. Leans on the boolean/arrangement engine already powering Shape Builder.
- **Warp / Envelope distort** — *Use: weekly · Effort: L.* Bend artwork through a mesh/warp. Needs a deformation layer over `toPath()` geometry.
- **Pattern / Repeat (radial, grid, mirror)** — *Use: weekly · Effort: M.* Illustrator's newer live repeats; derived instances like live Blend steps.
- **Image Trace** — *Use: weekly · Effort: L.* Raster → vector. Self-contained algorithm; big "wow", isolated from the core model.

## 04 · AI-era moves (2024–2025 Illustrator)

Where the product can leapfrog rather than catch up.

- **Generative Shape / Recolor (Firefly-style)** — *Use: emerging · Effort: L.* Prompt-to-vector and prompt-to-palette. Recolor Artwork is the natural on-ramp.
- **Retype / vectorized type from images** — *Use: niche · Effort: L.*
- **Mockup (art onto product shapes)** — *Use: niche · Effort: M.* Warp/Envelope reused as the placement engine.

---

## If I built five things *after* the shipped set

In order, weighing payoff against effort and how much each unlocks the next:

1. **Multiple fills & strokes** — the appearance stack; everything visual compounds on it.
2. **Swatches panel** — cheap, daily, and the foundation for Recolor + Patterns.
3. **Recolor Artwork** — the single biggest "I can't work without this" for real projects.
4. **Pattern fills** — reuses the defs registry; immediate visual range.
5. **Live Corners** — the small delight that makes shape editing feel modern.
