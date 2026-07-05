/**
 * The SEPARATE screen-space overlay SVG: selection outlines + bounding box
 * with 8 constant-size handles, the marquee, and snap guides. Everything is
 * drawn in SCREEN pixels (doc geometry converted via docToScreen /
 * worldTransform), so handle/outline weights stay constant at any zoom.
 * pointer-events: none — the viewport container owns all input.
 */

import type { BBox } from '../geometry/bbox'
import { localBBoxOfNode, transformBBox, unionBBox } from '../geometry/bbox'
import { applyToPoint } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { docToScreen } from '../store/coords'
import { useEditor } from '../store/store'
import { worldTransform } from '../store/worldTransform'

const ACCENT = '#3b82f6'
const HANDLE_SIZE = 8

export function Overlay() {
  const selection = useEditor((s) => s.selection)
  const nodes = useEditor((s) => s.document.nodes)
  const viewport = useEditor((s) => s.viewport)
  const marquee = useEditor((s) => s.ui.marquee)
  const guides = useEditor((s) => s.ui.snapGuides)

  // Per-node outline corners (tight, rotation-aware) + doc-space union bbox.
  const outlines: Vec2[][] = []
  let union: BBox | null = null
  for (const id of selection) {
    const node = nodes[id]
    if (!node) continue
    const local = localBBoxOfNode(node, nodes)
    if (!local) continue
    const world = worldTransform(nodes, id)
    const corners: Vec2[] = [
      { x: local.minX, y: local.minY },
      { x: local.maxX, y: local.minY },
      { x: local.maxX, y: local.maxY },
      { x: local.minX, y: local.maxY },
    ].map((p) => docToScreen(viewport, applyToPoint(world, p)))
    outlines.push(corners)
    union = unionBBox(union, transformBBox(world, local))
  }

  const box = union
    ? {
        x: union.minX * viewport.zoom + viewport.tx,
        y: union.minY * viewport.zoom + viewport.ty,
        w: (union.maxX - union.minX) * viewport.zoom,
        h: (union.maxY - union.minY) * viewport.zoom,
      }
    : null

  return (
    <svg className="overlay-svg">
      {outlines.map((corners, i) => (
        <polygon
          key={i}
          points={corners.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={ACCENT}
          strokeWidth={1}
        />
      ))}
      {box && (
        <>
          <rect
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1}
          />
          {handlePositions(box).map((p, i) => (
            <rect
              key={i}
              x={p.x - HANDLE_SIZE / 2}
              y={p.y - HANDLE_SIZE / 2}
              width={HANDLE_SIZE}
              height={HANDLE_SIZE}
              fill="#ffffff"
              stroke={ACCENT}
              strokeWidth={1}
            />
          ))}
        </>
      )}
      {marquee && <MarqueeRect rect={marquee} />}
      {guides.map((g, i) => {
        const a = docToScreen(viewport, g.a)
        const b = docToScreen(viewport, g.b)
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#e649b5"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )
      })}
    </svg>
  )
}

function MarqueeRect({ rect }: { rect: BBox }) {
  const viewport = useEditor((s) => s.viewport)
  const a = docToScreen(viewport, { x: rect.minX, y: rect.minY })
  const b = docToScreen(viewport, { x: rect.maxX, y: rect.maxY })
  return (
    <rect
      x={a.x}
      y={a.y}
      width={b.x - a.x}
      height={b.y - a.y}
      fill="rgba(59,130,246,0.08)"
      stroke={ACCENT}
      strokeWidth={1}
      strokeDasharray="4 3"
    />
  )
}

function handlePositions(box: { x: number; y: number; w: number; h: number }): Vec2[] {
  const { x, y, w, h } = box
  return [
    { x, y },
    { x: x + w / 2, y },
    { x: x + w, y },
    { x: x + w, y: y + h / 2 },
    { x: x + w, y: y + h },
    { x: x + w / 2, y: y + h },
    { x, y: y + h },
    { x, y: y + h / 2 },
  ]
}
