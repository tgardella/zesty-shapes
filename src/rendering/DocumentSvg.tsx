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
import { Defs } from './Defs'
import { NodeView } from './NodeView'

export function DocumentSvg() {
  return (
    <svg className="document-svg">
      <Defs />
      <PanZoomGroup>
        <Artboards />
        <GridView />
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

/** Extent of the grid sheet in doc units (well past any plausible artboard). */
const GRID_EXTENT = 100000

/**
 * The global grid (lines or dots), drawn in DOCUMENT space above the artboard
 * sheets and below the scene. One SVG pattern + one covering rect; stroke and
 * dot sizes divide by zoom so the grid stays hairline at any magnification.
 */
const GridView = memo(function GridView() {
  const grid = useEditor((s) => s.ui.grid)
  const size = useEditor((s) => s.ui.gridSize)
  const zoom = useEditor((s) => s.viewport.zoom)
  if (!grid.show || size <= 0) return null
  // Skip when cells would be denser than ~4 screen px (unreadable + slow).
  if (size * zoom < 4) return null
  const hairline = 1 / zoom
  const dotR = Math.min(1.5 / zoom, size / 6)
  return (
    <g pointerEvents="none">
      <defs>
        <pattern id="__global-grid" width={size} height={size} patternUnits="userSpaceOnUse">
          {grid.style === 'lines' ? (
            <path
              d={`M ${size} 0 L 0 0 0 ${size}`}
              fill="none"
              stroke="rgba(96,118,180,0.35)"
              strokeWidth={hairline}
            />
          ) : (
            // A dot at each cell corner: quarter-dots in the four pattern
            // corners tile into full dots at every grid intersection.
            <>
              <circle cx={0} cy={0} r={dotR} fill="rgba(96,118,180,0.55)" />
              <circle cx={size} cy={0} r={dotR} fill="rgba(96,118,180,0.55)" />
              <circle cx={0} cy={size} r={dotR} fill="rgba(96,118,180,0.55)" />
              <circle cx={size} cy={size} r={dotR} fill="rgba(96,118,180,0.55)" />
            </>
          )}
        </pattern>
      </defs>
      <rect
        x={-GRID_EXTENT}
        y={-GRID_EXTENT}
        width={GRID_EXTENT * 2}
        height={GRID_EXTENT * 2}
        fill="url(#__global-grid)"
      />
    </g>
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
