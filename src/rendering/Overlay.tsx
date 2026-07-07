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
import { applyToPoint, compose, type Mat } from '../geometry/matrix'
import { subpathsToPathData, transformSubPaths } from '../geometry/pathData'
import type { Vec2 } from '../geometry/vec2'
import type { NodeId } from '../model/types'
import { toSubPaths } from '../model/nodes'
import { layerColorOf } from '../model/layers'
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
import { defaultToolSize, isSizeableTool } from '../tools/toolSizes'
import { widthHandleLayout } from '../tools/widthEditShared'

const ACCENT = '#3b82f6'
/** Corner-radius widget diamond radius (screen px). */
const RADIUS_DIAMOND_R = 5

export function Overlay() {
  const selection = useEditor((s) => s.selection)
  const nodes = useEditor((s) => s.document.nodes)
  const root = useEditor((s) => s.document.root)
  const viewport = useEditor((s) => s.viewport)
  const marquee = useEditor((s) => s.ui.marquee)
  const guides = useEditor((s) => s.ui.snapGuides)

  // Selection outlines/handles use the OWNING LAYER's color (Illustrator).
  const colorFor = (id: NodeId): string => layerColorOf({ nodes, root }, id) ?? ACCENT

  // Selection highlight: the EXACT geometry of every selected leaf (groups
  // recurse), transformed local -> world -> screen — not the bounding box.
  // Text (no outline geometry) falls back to its tight layout-bbox corners.
  const outlinePaths: { d: string; color: string }[] = []
  const textBoxes: { corners: Vec2[]; color: string }[] = []
  const screenMat: Mat = [viewport.zoom, 0, 0, viewport.zoom, viewport.tx, viewport.ty]
  const collectOutline = (id: NodeId, color: string): void => {
    const node = nodes[id]
    if (!node || node.hidden) return
    if (node.type === 'group') {
      for (const child of node.children) collectOutline(child, color)
      return
    }
    const world = worldTransform(nodes, id)
    if (node.type === 'text') {
      const local = localBBoxOfNode(node, nodes)
      if (!local) return
      textBoxes.push({
        color,
        corners: [
          { x: local.minX, y: local.minY },
          { x: local.maxX, y: local.minY },
          { x: local.maxX, y: local.maxY },
          { x: local.minX, y: local.maxY },
        ].map((p) => docToScreen(viewport, applyToPoint(world, p))),
      })
      return
    }
    outlinePaths.push({
      color,
      d: subpathsToPathData(transformSubPaths(compose(screenMat, world), toSubPaths(node))),
    })
  }
  for (const id of selection) collectOutline(id, colorFor(id))

  const layout = selectionHandleLayout(nodes, selection, viewport)
  // The combined bounding box uses the primary selection's layer color.
  const boxColor = selection.length > 0 ? colorFor(selection[0]!) : ACCENT

  return (
    <svg className="overlay-svg">
      {outlinePaths.map((o, i) => (
        <path key={i} d={o.d} fill="none" stroke={o.color} strokeWidth={1.4} />
      ))}
      {textBoxes.map((t, i) => (
        <polygon
          key={i}
          points={t.corners.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={t.color}
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
            stroke={boxColor}
            strokeWidth={1}
          />
          {/* Rotation affordance: stem + knob (drag rotates; also the R tool). */}
          <line
            x1={layout.boxScreen.x + layout.boxScreen.w / 2}
            y1={layout.boxScreen.y - HANDLE_SIZE_PX / 2}
            x2={layout.rotationKnobScreen.x}
            y2={layout.rotationKnobScreen.y + ROTATE_KNOB_RADIUS_PX}
            stroke={boxColor}
            strokeWidth={1}
          />
          <circle
            cx={layout.rotationKnobScreen.x}
            cy={layout.rotationKnobScreen.y}
            r={ROTATE_KNOB_RADIUS_PX}
            fill="#ffffff"
            stroke={boxColor}
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
              stroke={boxColor}
              strokeWidth={1}
            />
          ))}
        </>
      )}
      <ArtboardOverlay />
      <SizeCursorView />
      <RadiusHandleView />
      <PathEditOverlay />
      <PenPreviewView />
      <GradientAnnotatorView />
      <WidthEditOverlay />
      <FacePreviewView />
      <CutTrailView />
      <LassoView />
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

/**
 * Artboard names (always) + the active artboard's frame and 8 resize handles
 * while the Artboard tool (Shift+O) is active. Screen space, constant size.
 */
function ArtboardOverlay() {
  const artboards = useEditor((s) => s.document.artboards)
  const activeToolId = useEditor((s) => s.tool.activeToolId)
  const activeId = useEditor((s) => s.ui.activeArtboardId)
  const viewport = useEditor((s) => s.viewport)
  const toolActive = activeToolId === 'artboard'
  return (
    <g>
      {artboards.map((ab) => {
        const tl = docToScreen(viewport, { x: ab.x, y: ab.y })
        const isActive = toolActive && ab.id === activeId
        return (
          <g key={ab.id}>
            <text x={tl.x} y={tl.y - 6} className="artboard-label" fill={isActive ? ACCENT : '#8a8f9d'}>
              {ab.name}
            </text>
            {isActive && <ActiveArtboardFrame ab={ab} />}
          </g>
        )
      })}
    </g>
  )
}

function ActiveArtboardFrame({ ab }: { ab: { x: number; y: number; w: number; h: number } }) {
  const viewport = useEditor((s) => s.viewport)
  const tl = docToScreen(viewport, { x: ab.x, y: ab.y })
  const br = docToScreen(viewport, { x: ab.x + ab.w, y: ab.y + ab.h })
  const handles: Vec2[] = []
  for (const uy of [0, 0.5, 1]) {
    for (const ux of [0, 0.5, 1]) {
      if (ux === 0.5 && uy === 0.5) continue
      handles.push({ x: tl.x + (br.x - tl.x) * ux, y: tl.y + (br.y - tl.y) * uy })
    }
  }
  return (
    <g>
      <rect
        x={tl.x}
        y={tl.y}
        width={br.x - tl.x}
        height={br.y - tl.y}
        fill="none"
        stroke={ACCENT}
        strokeWidth={1.4}
      />
      {handles.map((p, i) => (
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
    </g>
  )
}

/**
 * Tool-size cursor: a translucent, light-bordered circle showing the active
 * tool's exact size (doc-space diameter, so it scales with zoom), tracking
 * the pointer. Only for tools registered in TOOL_SIZE_SPECS.
 */
function SizeCursorView() {
  const activeToolId = useEditor((s) => s.tool.activeToolId)
  const pointer = useEditor((s) => s.ui.pointer)
  const sizes = useEditor((s) => s.ui.toolSizes)
  const viewport = useEditor((s) => s.viewport)
  if (!pointer || !isSizeableTool(activeToolId)) return null
  const size = sizes[activeToolId] ?? defaultToolSize(activeToolId)
  const c = docToScreen(viewport, pointer)
  const r = (size / 2) * viewport.zoom
  return (
    <circle
      cx={c.x}
      cy={c.y}
      r={Math.max(r, 1)}
      fill="rgba(128,140,160,0.12)"
      stroke="rgba(140,150,170,0.75)"
      strokeWidth={1}
    />
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
  const root = useEditor((s) => s.document.root)
  const viewport = useEditor((s) => s.viewport)
  if (!pathEdit) return null
  const node = nodes[pathEdit.nodeId]
  if (!node || node.type !== 'path' || node.hidden) return null
  const accent = layerColorOf({ nodes, root }, node.id) ?? ACCENT
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
              stroke={accent}
              strokeWidth={1}
            />,
            <circle key={`${a.id}-dot-${end}`} cx={hs.x} cy={hs.y} r={HANDLE_DOT_R} fill={accent} />,
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
          fill={isSel ? accent : '#ffffff'}
          stroke={accent}
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

/**
 * Shape Builder face highlight: the hovered/gestured atomic region, filled
 * translucently. Region rings arrive in DOC space; even-odd keeps holes open.
 */
function FacePreviewView() {
  const region = useEditor((s) => s.ui.facePreview)
  const viewport = useEditor((s) => s.viewport)
  if (!region) return null
  let d = ''
  for (const ring of region) {
    if (ring.length < 3) continue
    const pts = ring.map((p) => docToScreen(viewport, p))
    d += `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')} Z `
  }
  if (d === '') return null
  return (
    <path
      d={d}
      fill="rgba(59,130,246,0.25)"
      fillRule="evenodd"
      stroke={ACCENT}
      strokeWidth={1.4}
    />
  )
}

/** Lasso (Q) freehand region while dragging. */
function LassoView() {
  const trail = useEditor((s) => s.ui.lasso)
  const viewport = useEditor((s) => s.viewport)
  if (!trail || trail.length < 2) return null
  const pts = trail.map((p) => docToScreen(viewport, p))
  return (
    <polygon
      points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
      fill="rgba(59,130,246,0.08)"
      stroke={ACCENT}
      strokeWidth={1}
      strokeDasharray="4 3"
    />
  )
}

/** Knife/Eraser freehand trail while dragging. */
function CutTrailView() {
  const trail = useEditor((s) => s.ui.cutTrail)
  const viewport = useEditor((s) => s.viewport)
  if (!trail || trail.length < 2) return null
  const pts = trail.map((p) => docToScreen(viewport, p))
  return (
    <polyline
      points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
      fill="none"
      stroke="#e64545"
      strokeWidth={1.5}
      strokeDasharray="5 3"
      strokeLinecap="round"
    />
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
