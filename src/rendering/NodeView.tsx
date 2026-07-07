/**
 * Renders one scene node as native SVG. React.memo keyed by node id; each
 * instance subscribes ONLY to its own node object, so pan/zoom (viewport
 * state) and edits to other nodes never re-render it.
 *
 * Parametric shapes render as native <rect>/<ellipse>/<line>; polygon/star/
 * path render as <path>. Each node applies its OWN transform; ancestor group
 * <g> nesting composes the effective transform naturally.
 *
 * Gradient paints resolve to url(#id) through the live defs registry (the
 * <Defs> component renders the matching defs in the same commit). Styles with
 * a widthProfile render as REAL geometry: the stroke's filled outline through
 * the boolean engine (model/strokeOutline.ts), matching the exporter.
 *
 * Every element carries data-node-id for the DOM hit-test pipeline (outlined
 * strokes carry it on their wrapping <g>; `closest()` resolves children).
 */

import { memo } from 'react'
import type { CSSProperties } from 'react'
import { isIdentity, toSvgTransform } from '../geometry/matrix'
import { subpathsToPathData } from '../geometry/pathData'
import type { GradientPaint, NodeId, SceneNode } from '../model/types'
import { toSubPaths } from '../model/nodes'
import { imageDimFactor } from '../model/layers'
import { meshQuads, meshSeamWidth } from '../model/mesh'
import { regionsToSubPaths } from '../model/booleanOps'
import { outlineStroke } from '../model/strokeOutline'
import { layoutText } from '../model/textLayout'
import { hasWidthProfile } from '../model/widthProfile'
import { liveDefs } from '../store/liveDefs'
import { editorStore, useEditor } from '../store/store'
import { svgPaintProps } from './styleAttrs'

/**
 * Non-reactive resolver: idempotently syncs the live registry against the
 * CURRENT nodes map, then looks the paint up. Safe without a subscription —
 * a def id can only change when its paint changes, which re-renders the
 * owning NodeView anyway.
 */
function resolveDefId(paint: GradientPaint): string | null {
  liveDefs.ensure(editorStore.getState().document.nodes)
  return liveDefs.defIdFor(paint)
}

export const NodeView = memo(function NodeView({ id }: { id: NodeId }) {
  const node = useEditor((s) => s.document.nodes[id])
  if (!node || node.hidden) return null

  const transform = isIdentity(node.transform) ? undefined : toSvgTransform(node.transform)
  const opacity = node.opacity < 1 ? node.opacity : undefined
  const style: CSSProperties | undefined =
    node.blendMode !== 'normal' ? { mixBlendMode: node.blendMode } : undefined

  if (node.type === 'group') {
    return (
      <g data-node-id={id} transform={transform} opacity={opacity} style={style}>
        {node.children.map((childId) => (
          <NodeView key={childId} id={childId} />
        ))}
      </g>
    )
  }

  return <ShapeView node={node} transform={transform} opacity={opacity} style={style} />
})

function ShapeView({
  node,
  transform,
  opacity,
  style,
}: {
  node: Exclude<SceneNode, { type: 'group' }>
  transform: string | undefined
  opacity: number | undefined
  style: CSSProperties | undefined
}) {
  if (node.type !== 'text' && hasWidthProfile(node.style)) {
    return (
      <VariableWidthView node={node} transform={transform} opacity={opacity} style={style} />
    )
  }

  const common = {
    'data-node-id': node.id,
    transform,
    opacity,
    style,
    ...svgPaintProps(node.style, resolveDefId),
  }

  switch (node.type) {
    case 'rect':
      return (
        <rect
          {...common}
          x={node.x}
          y={node.y}
          width={node.w}
          height={node.h}
          rx={node.rx > 0 ? node.rx : undefined}
          ry={node.ry > 0 ? node.ry : undefined}
        />
      )
    case 'ellipse':
      return <ellipse {...common} cx={node.cx} cy={node.cy} rx={node.rx} ry={node.ry} />
    case 'line':
      return <line {...common} x1={node.x1} y1={node.y1} x2={node.x2} y2={node.y2} />
    case 'polygon':
    case 'star':
    case 'path':
      return (
        <path {...common} d={subpathsToPathData(toSubPaths(node))} fillRule={node.style.fillRule} />
      )
    case 'text':
      return <TextView node={node} transform={transform} opacity={opacity} style={style} />
    case 'image':
      return <ImageView node={node} transform={transform} opacity={opacity} style={style} />
    case 'mesh':
      return <MeshView node={node} transform={transform} opacity={opacity} style={style} />
  }
}

/**
 * Gradient mesh: the smooth surface approximated by bilinear sub-quads
 * (model/mesh.ts — the SAME quads the exporter emits), clipped to the source
 * shape's outline. Each quad is stroked with its own color to hide
 * antialiasing seams. An invisible outline path keeps the whole mesh
 * clickable for the DOM hit-test even where quads were dragged outside it.
 */
function MeshView({
  node,
  transform,
  opacity,
  style,
}: {
  node: Extract<SceneNode, { type: 'mesh' }>
  transform: string | undefined
  opacity: number | undefined
  style: CSSProperties | undefined
}) {
  const quads = meshQuads(node)
  const seam = meshSeamWidth(node)
  const outlineD = node.outline ? subpathsToPathData(node.outline) : ''
  const clipId = `mesh-clip-${node.id}`
  return (
    <g data-node-id={node.id} transform={transform} opacity={opacity} style={style}>
      {outlineD !== '' && (
        <clipPath id={clipId}>
          <path d={outlineD} />
        </clipPath>
      )}
      <g clipPath={outlineD !== '' ? `url(#${clipId})` : undefined}>
        {quads.map((q, i) => {
          const c = q.color
          const fill = `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`
          return (
            <polygon
              key={i}
              points={q.pts.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={fill}
              fillOpacity={c.a < 1 ? c.a : undefined}
              stroke={fill}
              strokeOpacity={c.a < 1 ? c.a : undefined}
              strokeWidth={seam}
            />
          )
        })}
      </g>
      {outlineD !== '' && <path d={outlineD} fill="none" stroke="none" pointerEvents="fill" />}
    </g>
  )
}

/**
 * Placed raster image. Its effective opacity multiplies the node opacity by
 * the owning layer's "Dim Images" factor (also driven by Template layers), so
 * dimmed layers fade their photos for tracing without altering the model.
 */
function ImageView({
  node,
  transform,
  opacity,
  style,
}: {
  node: Extract<SceneNode, { type: 'image' }>
  transform: string | undefined
  opacity: number | undefined
  style: CSSProperties | undefined
}) {
  const dim = useEditor((s) => imageDimFactor(s.document, node.id))
  const eff = (opacity ?? 1) * dim
  return (
    <image
      data-node-id={node.id}
      transform={transform}
      opacity={eff < 1 ? eff : undefined}
      style={style}
      href={node.href}
      width={node.w}
      height={node.h}
      preserveAspectRatio="none"
    />
  )
}

/**
 * Text rendering from the SAME layout the exporter and bbox use
 * (model/textLayout with the canvas measurer): point/area text emits one
 * <tspan> per line carrying a per-char x-list (exact tracking/kerning);
 * path text and vertical type emit one <tspan> per glyph (with rotate for
 * path text). Hidden while this node is being edited in place — the HTML
 * editor overlay is the live view then. An invisible bbox rect makes the
 * whole text block clickable — SVG text only hit-tests painted glyph pixels,
 * which made clicking back into text unreliable.
 */
function TextView({
  node,
  transform,
  opacity,
  style,
}: {
  node: Extract<SceneNode, { type: 'text' }>
  transform: string | undefined
  opacity: number | undefined
  style: CSSProperties | undefined
}) {
  const editing = useEditor((s) => s.ui.textEdit?.nodeId === node.id)
  if (editing) return null
  const layout = layoutText(node)
  const b = layout.bbox
  const hitRect =
    Number.isFinite(b.minX) && b.maxX > b.minX && b.maxY > b.minY ? b : null
  return (
    <g data-node-id={node.id} transform={transform} opacity={opacity} style={style}>
      {hitRect && (
        <rect
          x={hitRect.minX}
          y={hitRect.minY}
          width={hitRect.maxX - hitRect.minX}
          height={hitRect.maxY - hitRect.minY}
          fill="none"
          stroke="none"
          pointerEvents="fill"
        />
      )}
      <text
        {...svgPaintProps(node.style, resolveDefId)}
        fontFamily={node.fontFamily}
        fontSize={node.fontSize}
        fontWeight={node.fontWeight}
        xmlSpace="preserve"
      >
      {layout.mode === 'lines'
        ? layout.lines.map((line, i) => (
            <tspan key={i} x={line.xs.map((v) => Math.round(v * 100) / 100).join(' ')} y={line.y}>
              {line.text}
            </tspan>
          ))
        : layout.glyphs.map((g, i) => (
            <tspan
              key={i}
              x={g.x}
              y={g.y}
              rotate={g.rotate !== undefined ? Math.round(g.rotate * 10) / 10 : undefined}
            >
              {g.char}
            </tspan>
          ))}
      </text>
    </g>
  )
}

/**
 * Variable-width strokes render as REAL geometry: the stroke's filled
 * outline (model/strokeOutline via the boolean engine), painted with the
 * stroke paint under even-odd, plus the fill as a normal path underneath.
 * The exporter emits the same construction. Dash patterns do not apply to
 * outlined strokes (deferred).
 */
function VariableWidthView({
  node,
  transform,
  opacity,
  style,
}: {
  node: Exclude<SceneNode, { type: 'group' | 'text' }>
  transform: string | undefined
  opacity: number | undefined
  style: CSSProperties | undefined
}) {
  const subpaths = toSubPaths(node)
  const outline = outlineStroke(subpaths, node.style)
  const outlineD = outline ? subpathsToPathData(regionsToSubPaths(outline)) : ''
  const paint = svgPaintProps(node.style, resolveDefId)
  const fillD = node.style.fill ? subpathsToPathData(subpaths) : ''
  return (
    <g data-node-id={node.id} transform={transform} opacity={opacity} style={style}>
      {fillD !== '' && (
        <path
          d={fillD}
          fill={paint.fill}
          fillOpacity={paint.fillOpacity}
          fillRule={node.style.fillRule}
          stroke="none"
        />
      )}
      {outlineD !== '' && (
        <path
          d={outlineD}
          fill={paint.stroke}
          fillOpacity={paint.strokeOpacity}
          fillRule="evenodd"
          stroke="none"
        />
      )}
    </g>
  )
}
