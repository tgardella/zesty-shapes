/**
 * The document SVG: artboards + scene, inside ONE pan/zoom <g>.
 *
 * Pan/zoom lives ONLY on that root <g> transform. DocumentSvg itself
 * subscribes to nothing — PanZoomGroup subscribes to the viewport and its
 * `children` prop keeps a stable identity, so scene nodes are never
 * re-rendered by panning or zooming (verify with React DevTools highlighting).
 */

import { memo, type ReactNode } from 'react'
import type { GroupNode } from '../model/types'
import { useEditor } from '../store/store'
import { NodeView } from './NodeView'

export function DocumentSvg() {
  return (
    <svg className="document-svg">
      <PanZoomGroup>
        <Artboards />
        <SceneChildren />
      </PanZoomGroup>
    </svg>
  )
}

function PanZoomGroup({ children }: { children: ReactNode }) {
  const viewport = useEditor((s) => s.viewport)
  return (
    <g transform={`matrix(${viewport.zoom},0,0,${viewport.zoom},${viewport.tx},${viewport.ty})`}>
      {children}
    </g>
  )
}

const Artboards = memo(function Artboards() {
  const artboards = useEditor((s) => s.document.artboards)
  return (
    <>
      {artboards.map((ab) => (
        <rect
          key={ab.id}
          className="artboard"
          x={ab.x}
          y={ab.y}
          width={ab.w}
          height={ab.h}
          fill="#ffffff"
          stroke="#c3c6d1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </>
  )
})

const SceneChildren = memo(function SceneChildren() {
  const children = useEditor((s) => (s.document.nodes[s.document.root] as GroupNode).children)
  return (
    <>
      {children.map((id) => (
        <NodeView key={id} id={id} />
      ))}
    </>
  )
})
