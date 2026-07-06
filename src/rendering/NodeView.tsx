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
 * a widthProfile render as the variable-width APPROXIMATION: the fill as one
 * path plus many short stroke chunks at interpolated widths (see
 * model/widthProfile.ts for the deferral story).
 *
 * Every element carries data-node-id for the DOM hit-test pipeline (chunked
 * strokes carry it on their wrapping <g>; `closest()` resolves children).
 */

import { memo } from 'react'
import type { CSSProperties } from 'react'
import { isIdentity, toSvgTransform } from '../geometry/matrix'
import { subpathsToPathData } from '../geometry/pathData'
import type { GradientPaint, NodeId, SceneNode } from '../model/types'
import { toSubPaths } from '../model/nodes'
import { chunkPathData, hasWidthProfile, widthChunks } from '../model/widthProfile'
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
      return null // RESERVED: Type tool ships in a later phase
  }
}

/**
 * Variable-width APPROXIMATION: the fill as one normal path (stroke=none) +
 * one short 2-point chunk per flattened sample pair, each stroked at its
 * interpolated width with round caps/joins hiding the joints. Dash patterns
 * do not apply to chunked strokes (deferred with the true outline).
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
  const chunks = widthChunks(subpaths, node.style)
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
      {chunks && (
        <g
          fill="none"
          stroke={paint.stroke}
          strokeOpacity={paint.strokeOpacity}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {chunks.map((chunk, i) => (
            <path key={i} d={chunkPathData(chunk)} strokeWidth={chunk.width} />
          ))}
        </g>
      )}
    </g>
  )
}
