/**
 * The SEPARATE screen-space overlay SVG: selection outlines + bounding box
 * with 8 constant-size handles and the rotation knob, the marquee, and snap
 * guides. Everything is drawn in SCREEN pixels (doc geometry converted via
 * docToScreen / worldTransform), so handle/outline weights stay constant at
 * any zoom. Handle GEOMETRY comes from tools/handles.selectionHandleLayout —
 * the same function the transform gestures hit-test against.
 * pointer-events: none — the viewport container owns all input.
 */

import type { ReactElement } from 'react'
import type { BBox } from '../geometry/bbox'
import { localBBoxOfNode } from '../geometry/bbox'
import { applyToPoint } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { docToScreen } from '../store/coords'
import { useEditor } from '../store/store'
import { worldTransform } from '../store/worldTransform'
import {
  HANDLE_SIZE_PX,
  ROTATE_KNOB_RADIUS_PX,
  rectRadiusHandle,
  selectionHandleLayout,
} from '../tools/handles'
import { gradientAnnotatorLayout } from '../tools/gradientAnnotator'
import { widthHandleLayout } from '../tools/widthEditShared'

const ACCENT = '#3b82f6'
/** Corner-radius widget diamond radius (screen px). */
const RADIUS_DIAMOND_R = 5

export function Overlay() {
  const selection = useEditor((s) => s.selection)
  const nodes = useEditor((s) => s.document.nodes)
  const viewport = useEditor((s) => s.viewport)
  const marquee = useEditor((s) => s.ui.marquee)
  const guides = useEditor((s) => s.ui.snapGuides)

  // Per-node outline corners (tight, rotation-aware).
  const outlines: Vec2[][] = []
  for (const id of selection) {
    const node = nodes[id]
    if (!node) continue
    const local = localBBoxOfNode(node, nodes)
    if (!local) continue
    const world = worldTransform(nodes, id)
    outlines.push(
      [
        { x: local.minX, y: local.minY },
        { x: local.maxX, y: local.minY },
        { x: local.maxX, y: local.maxY },
        { x: local.minX, y: local.maxY },
      ].map((p) => docToScreen(viewport, applyToPoint(world, p))),
    )
  }

  const layout = selectionHandleLayout(nodes, selection, viewport)

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
      {layout && (
        <>
          <rect
            x={layout.boxScreen.x}
            y={layout.boxScreen.y}
            width={layout.boxScreen.w}
            height={layout.boxScreen.h}
            fill="none"
            stroke={ACCENT}
            strokeWidth={1}
          />
          {/* Rotation affordance: stem + knob (drag rotates; also the R tool). */}
          <line
            x1={layout.boxScreen.x + layout.boxScreen.w / 2}
            y1={layout.boxScreen.y - HANDLE_SIZE_PX / 2}
            x2={layout.rotationKnobScreen.x}
            y2={layout.rotationKnobScreen.y + ROTATE_KNOB_RADIUS_PX}
            stroke={ACCENT}
            strokeWidth={1}
          />
          <circle
            cx={layout.rotationKnobScreen.x}
            cy={layout.rotationKnobScreen.y}
            r={ROTATE_KNOB_RADIUS_PX}
            fill="#ffffff"
            stroke={ACCENT}
            strokeWidth={1}
          />
          {layout.handlesScreen.map((p, i) => (
            <rect
              key={i}
              x={p.x - HANDLE_SIZE_PX / 2}
              y={p.y - HANDLE_SIZE_PX / 2}
              width={HANDLE_SIZE_PX}
              height={HANDLE_SIZE_PX}
              fill="#ffffff"
              stroke={ACCENT}
              strokeWidth={1}
            />
          ))}
        </>
      )}
      <RadiusHandleView />
      <PathEditOverlay />
      <PenPreviewView />
      <GradientAnnotatorView />
      <WidthEditOverlay />
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

/** Live corner-radius widget for a single selected RectNode (diamond marker). */
function RadiusHandleView() {
  const nodes = useEditor((s) => s.document.nodes)
  const selection = useEditor((s) => s.selection)
  const viewport = useEditor((s) => s.viewport)
  const handle = rectRadiusHandle(nodes, selection, viewport)
  if (!handle) return null
  const { x, y } = handle.screenPoint
  const r = RADIUS_DIAMOND_R
  return (
    <polygon
      points={`${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`}
      fill="#ffffff"
      stroke={ACCENT}
      strokeWidth={1.2}
    />
  )
}

const ANCHOR_SIZE = 6
const HANDLE_DOT_R = 2.6

/**
 * Anchors + bezier handles of the path-edit target (Direct Selection, Pen,
 * Curvature...). Squares = corner anchors, diamonds = smooth/symmetric; all
 * constant screen size. Positions go local -> world -> screen, so anchors of
 * rotated/nested paths land exactly on the visible geometry. Handle lines +
 * dots are drawn for SELECTED anchors.
 */
function PathEditOverlay() {
  const pathEdit = useEditor((s) => s.ui.pathEdit)
  const nodes = useEditor((s) => s.document.nodes)
  const viewport = useEditor((s) => s.viewport)
  if (!pathEdit) return null
  const node = nodes[pathEdit.nodeId]
  if (!node || node.type !== 'path' || node.hidden) return null
  const world = worldTransform(nodes, node.id)
  const toScreen = (p: Vec2) => docToScreen(viewport, applyToPoint(world, p))
  const selected = new Set(pathEdit.anchorIds)

  const anchorSquares: ReactElement[] = []
  const handleGraphics: ReactElement[] = []
  for (const sp of node.subpaths) {
    for (const a of sp.anchors) {
      const s = toScreen(a.point)
      const isSel = selected.has(a.id)
      if (isSel) {
        for (const end of ['in', 'out'] as const) {
          const h = end === 'in' ? a.handleIn : a.handleOut
          if (!h) continue
          const hs = toScreen(h)
          handleGraphics.push(
            <line
              key={`${a.id}-line-${end}`}
              x1={s.x}
              y1={s.y}
              x2={hs.x}
              y2={hs.y}
              stroke={ACCENT}
              strokeWidth={1}
            />,
            <circle key={`${a.id}-dot-${end}`} cx={hs.x} cy={hs.y} r={HANDLE_DOT_R} fill={ACCENT} />,
          )
        }
      }
      anchorSquares.push(
        <rect
          key={a.id}
          x={s.x - ANCHOR_SIZE / 2}
          y={s.y - ANCHOR_SIZE / 2}
          width={ANCHOR_SIZE}
          height={ANCHOR_SIZE}
          fill={isSel ? ACCENT : '#ffffff'}
          stroke={ACCENT}
          strokeWidth={1}
          transform={a.type !== 'corner' ? `rotate(45 ${s.x} ${s.y})` : undefined}
        />,
      )
    }
  }
  return (
    <g>
      {handleGraphics}
      {anchorSquares}
    </g>
  )
}

/** Pen rubber band: the exact would-be cubic from the last anchor to the cursor. */
function PenPreviewView() {
  const preview = useEditor((s) => s.ui.penPreview)
  const viewport = useEditor((s) => s.viewport)
  if (!preview) return null
  const from = docToScreen(viewport, preview.from)
  const to = docToScreen(viewport, preview.to)
  const c1 = preview.fromHandle ? docToScreen(viewport, preview.fromHandle) : from
  return (
    <path
      d={`M ${from.x} ${from.y} C ${c1.x} ${c1.y} ${to.x} ${to.y} ${to.x} ${to.y}`}
      fill="none"
      stroke={ACCENT}
      strokeWidth={1}
      opacity={0.7}
    />
  )
}

/**
 * On-canvas gradient annotator (Gradient tool, G): axis line with a square
 * start handle and round end handle; radial adds the gradient circle. Layout
 * comes from tools/gradientAnnotator — the SAME function the tool hit-tests
 * against. Constant screen size at any zoom.
 */
function GradientAnnotatorView() {
  const activeToolId = useEditor((s) => s.tool.activeToolId)
  const nodes = useEditor((s) => s.document.nodes)
  const selection = useEditor((s) => s.selection)
  const target = useEditor((s) => s.ui.styleTarget)
  const viewport = useEditor((s) => s.viewport)
  if (activeToolId !== 'gradient') return null
  const layout = gradientAnnotatorLayout(nodes, selection, target, viewport)
  if (!layout) return null
  const { aScreen: a, bScreen: b } = layout
  return (
    <g>
      {layout.circleScreen && (
        <polygon
          points={layout.circleScreen.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={ACCENT}
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.8}
        />
      )}
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ACCENT} strokeWidth={1.4} />
      <rect
        x={a.x - 4}
        y={a.y - 4}
        width={8}
        height={8}
        fill="#ffffff"
        stroke={ACCENT}
        strokeWidth={1.2}
      />
      <circle cx={b.x} cy={b.y} r={4.5} fill="#ffffff" stroke={ACCENT} strokeWidth={1.2} />
    </g>
  )
}

/**
 * Width tool handles: for each width stop, a diamond on the path spine and
 * two dots at the visual half-width extents connected by a rung. Layout from
 * tools/widthEditShared — the same function the tool hit-tests against.
 */
function WidthEditOverlay() {
  const activeToolId = useEditor((s) => s.tool.activeToolId)
  const nodes = useEditor((s) => s.document.nodes)
  const widthEdit = useEditor((s) => s.ui.widthEdit)
  const viewport = useEditor((s) => s.viewport)
  if (activeToolId !== 'width') return null
  const layout = widthHandleLayout(nodes, widthEdit, viewport)
  if (!layout) return null
  const r = 4
  return (
    <g>
      {layout.stops.map((stop) => {
        const s = stop.spineScreen
        return (
          <g key={stop.index}>
            <line
              x1={stop.dotAScreen.x}
              y1={stop.dotAScreen.y}
              x2={stop.dotBScreen.x}
              y2={stop.dotBScreen.y}
              stroke={ACCENT}
              strokeWidth={1}
              strokeDasharray="3 2"
            />
            <circle cx={stop.dotAScreen.x} cy={stop.dotAScreen.y} r={3.4} fill={ACCENT} />
            <circle cx={stop.dotBScreen.x} cy={stop.dotBScreen.y} r={3.4} fill={ACCENT} />
            <polygon
              points={`${s.x},${s.y - r} ${s.x + r},${s.y} ${s.x},${s.y + r} ${s.x - r},${s.y}`}
              fill="#ffffff"
              stroke={ACCENT}
              strokeWidth={1.2}
            />
          </g>
        )
      })}
    </g>
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
