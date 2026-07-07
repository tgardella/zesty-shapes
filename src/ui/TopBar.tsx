/**
 * Top bar: zoom, grid display/units + snap, per-tool size, Open (import),
 * Convert to Path, and the Export dialog. Export is emitted DIRECTLY from
 * the model (documentToSVG and the exporters built on it), never from the
 * rendered DOM.
 */

import { useRef, useState } from 'react'
import { importFile } from '../import/importFiles'
import { editorStore, useEditor } from '../store/store'
import { cmdConvertToPath } from '../store/commands'
import { TOOL_SIZE_SPECS } from '../tools/toolSizes'
import { ExportDialog } from './ExportDialog'

/** Grid spacing presets in doc units (CSS px): 96/inch, ~37.8/cm. */
const UNIT_SIZES = { inch: 96, cm: 96 / 2.54 } as const

function viewportCenter(): { x: number; y: number } {
  const el = document.querySelector('.viewport')
  if (el) {
    const r = el.getBoundingClientRect()
    return { x: r.width / 2, y: r.height / 2 }
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
}

const CONVERTIBLE = new Set(['rect', 'ellipse', 'polygon', 'star', 'line'])

export function TopBar() {
  const zoom = useEditor((s) => s.viewport.zoom)
  const snapToGrid = useEditor((s) => s.ui.snapToGrid)
  const grid = useEditor((s) => s.ui.grid)
  const gridSize = useEditor((s) => s.ui.gridSize)
  const activeToolId = useEditor((s) => s.tool.activeToolId)
  const toolSize = useEditor((s) => s.ui.toolSizes[s.tool.activeToolId])
  const canConvert = useEditor((s) =>
    s.selection.some((id) => CONVERTIBLE.has(s.document.nodes[id]?.type ?? '')),
  )
  const [exporting, setExporting] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const zoomBy = (factor: number) => editorStore.getState().zoomAtPoint(viewportCenter(), factor)
  const sizeSpec = TOOL_SIZE_SPECS[activeToolId]

  const setUnit = (unit: 'inch' | 'cm' | 'custom'): void => {
    const state = editorStore.getState()
    state.setGrid({ unit })
    if (unit !== 'custom') state.setGridSize(UNIT_SIZES[unit])
  }

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

      <label className="snap-toggle" title="Display the global grid; shapes lock to it">
        <input
          type="checkbox"
          checked={grid.show}
          onChange={(e) => {
            // Toggling the grid on locks shapes to it (and off releases them);
            // the separate Snap checkbox still gives independent control.
            editorStore.getState().setGrid({ show: e.target.checked })
            editorStore.getState().setSnapToGrid(e.target.checked)
          }}
        />
        Grid
      </label>
      {grid.show && (
        <>
          <select
            className="grid-select"
            value={grid.style}
            onChange={(e) => editorStore.getState().setGrid({ style: e.target.value as 'lines' | 'dots' })}
            title="Grid style"
          >
            <option value="lines">Lines</option>
            <option value="dots">Dots</option>
          </select>
          <select
            className="grid-select"
            value={grid.unit}
            onChange={(e) => setUnit(e.target.value as 'inch' | 'cm' | 'custom')}
            title="Grid unit"
          >
            <option value="inch">Inch</option>
            <option value="cm">cm</option>
            <option value="custom">Custom</option>
          </select>
          {grid.unit === 'custom' && (
            <input
              className="grid-size-input"
              type="number"
              min={1}
              step={1}
              value={Math.round(gridSize * 100) / 100}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (!Number.isNaN(v) && v > 0) editorStore.getState().setGridSize(v)
              }}
              title="Grid spacing (px)"
            />
          )}
        </>
      )}
      <label className="snap-toggle">
        <input
          type="checkbox"
          checked={snapToGrid}
          onChange={(e) => editorStore.getState().setSnapToGrid(e.target.checked)}
        />
        Snap to grid
      </label>

      {sizeSpec && (
        <label className="tool-size" title={`${sizeSpec.label} for the active tool (doc units)`}>
          {sizeSpec.label}
          <input
            type="range"
            min={sizeSpec.min}
            max={sizeSpec.max}
            step={0.25}
            value={toolSize ?? sizeSpec.default}
            onChange={(e) =>
              editorStore.getState().setToolSize(activeToolId, parseFloat(e.target.value))
            }
          />
          <input
            className="tool-size-num"
            type="number"
            min={sizeSpec.min}
            max={sizeSpec.max}
            step={0.25}
            value={toolSize ?? sizeSpec.default}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!Number.isNaN(v)) editorStore.getState().setToolSize(activeToolId, v)
            }}
          />
        </label>
      )}

      <div className="topbar-spacer" />

      <input
        ref={fileRef}
        type="file"
        accept=".svg,.png,.jpg,.jpeg,.pdf,image/svg+xml,image/png,image/jpeg,application/pdf"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          for (const f of Array.from(e.target.files ?? [])) void importFile(editorStore, f)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        className="to-path-btn"
        title="Open an SVG, PNG, JPG, or PDF as editable content"
        onClick={() => fileRef.current?.click()}
      >
        Open…
      </button>
      <button
        type="button"
        className="to-path-btn"
        disabled={!canConvert}
        title="Convert selected shapes to editable paths (transform preserved)"
        onClick={() => cmdConvertToPath(editorStore, editorStore.getState().selection)}
      >
        To Path
      </button>
      <button type="button" className="export-btn" onClick={() => setExporting(true)}>
        Export…
      </button>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  )
}
