/**
 * Renders one scene node as native SVG. React.memo keyed by node id; each
 * instance subscribes ONLY to its own node object, so pan/zoom (viewport
 * state) and edits to other nodes never re-render it.
 *
 * Parametric shapes render as native <rect>/<ellipse>/<line>; polygon/star/
 * path render as <path>. Each node applies its OWN transform; ancestor group
 * <g> nesting composes the effective transform naturally.
 *
 * Every element carries data-node-id for the DOM hit-test pipeline.
 */

import { memo } from 'react'
import type { CSSProperties } from 'react'
import { isIdentity, toSvgTransform } from '../geometry/matrix'
import { subpathsToPathData } from '../geometry/pathData'
import type { NodeId, SceneNode } from '../model/types'
import { toSubPaths } from '../model/nodes'
import { useEditor } from '../store/store'
import { svgPaintProps } from './styleAttrs'

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
  const common = {
    'data-node-id': node.id,
    transform,
    opacity,
    style,
    ...svgPaintProps(node.style),
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
