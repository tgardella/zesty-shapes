# zesty-shapes

A simplified, genuinely-usable vector graphics editor (Illustrator-like) built with
**React + Vite + TypeScript**.

Rendering is an SVG-DOM scene graph with a separate screen-space overlay for selection
handles and guides. The document is a normalized, id-keyed node map with parametric shapes
(that convert to editable Bézier paths), patch-based undo/redo, and a pluggable tool system.

Built in phases — foundation first (document model, rendering, coordinate system, tool
framework, undo, geometry library), then tool groups added incrementally.

## Getting started

```bash
npm install
npm run dev
```

_Status: scaffolding in progress._
