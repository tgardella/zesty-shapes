/**
 * Top bar: zoom indicator/controls, snap-to-grid toggle, and Export SVG —
 * the export is emitted DIRECTLY from the model (documentToSVG), never from
 * the rendered DOM.
 */

import { documentToSVG } from '../model/serialize'
import { cmdConvertToPath } from '../store/commands'
import { editorStore, useEditor } from '../store/store'

function viewportCenter(): { x: number; y: number } {
  const el = document.querySelector('.viewport')
  if (el) {
    const r = el.getBoundingClientRect()
    return { x: r.width / 2, y: r.height / 2 }
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

function exportSvg(): void {
  const doc = editorStore.getState().document
  const svg = documentToSVG(doc)
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${doc.name || 'zesty-shapes'}.svg`
  a.click()
  URL.revokeObjectURL(url)
}

const CONVERTIBLE = new Set(['rect', 'ellipse', 'polygon', 'star', 'line'])

export function TopBar() {
  const zoom = useEditor((s) => s.viewport.zoom)
  const snapToGrid = useEditor((s) => s.ui.snapToGrid)
  const canConvert = useEditor((s) =>
    s.selection.some((id) => CONVERTIBLE.has(s.document.nodes[id]?.type ?? '')),
  )

  const zoomBy = (factor: number) => editorStore.getState().zoomAtPoint(viewportCenter(), factor)

  return (
    <div className="topbar">
      <span className="app-title">zesty-shapes</span>
      <div className="zoom-controls">
        <button type="button" onClick={() => zoomBy(1 / 1.25)} title="Zoom out">
          −
        </button>
        <button
          type="button"
          className="zoom-label"
          onClick={() => zoomBy(1 / zoom)}
          title="Reset zoom to 100%"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" onClick={() => zoomBy(1.25)} title="Zoom in">
          +
        </button>
      </div>
      <label className="snap-toggle">
        <input
          type="checkbox"
          checked={snapToGrid}
          onChange={(e) => editorStore.getState().setSnapToGrid(e.target.checked)}
        />
        Snap to grid
      </label>
      <div className="topbar-spacer" />
      <button
        type="button"
        className="to-path-btn"
        disabled={!canConvert}
        title="Convert selected shapes to editable paths (transform preserved)"
        onClick={() => cmdConvertToPath(editorStore, editorStore.getState().selection)}
      >
        To Path
      </button>
      <button type="button" className="export-btn" onClick={exportSvg}>
        Export SVG
      </button>
    </div>
  )
}
