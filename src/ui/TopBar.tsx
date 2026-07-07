/**
 * Top bar: zoom, grid display/units + snap, and the per-tool size selector.
 * File operations (Open / Export) and object commands moved into the menu
 * bar (ui/MenuBar.tsx), like Illustrator.
 */

import { editorStore, useEditor } from '../store/store'
import { cmdSetBlendSteps } from '../store/blendCommands'
import { BUILTIN_BRUSHES } from '../model/brushLibrary'
import { rgbToHex } from '../model/color'
import { TOOL_SIZE_SPECS } from '../tools/toolSizes'

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

export function TopBar() {
  const zoom = useEditor((s) => s.viewport.zoom)
  const snapToGrid = useEditor((s) => s.ui.snapToGrid)
  const grid = useEditor((s) => s.ui.grid)
  const gridSize = useEditor((s) => s.ui.gridSize)
  const activeToolId = useEditor((s) => s.tool.activeToolId)
  const toolSize = useEditor((s) => s.ui.toolSizes[s.tool.activeToolId])
  const activeBrushId = useEditor((s) => s.ui.activeBrushId)
  const currentFill = useEditor((s) => s.ui.currentStyle.fill)

  const zoomBy = (factor: number) => editorStore.getState().zoomAtPoint(viewportCenter(), factor)
  const sizeSpec = TOOL_SIZE_SPECS[activeToolId]

  const setSize = (v: number): void => {
    const state = editorStore.getState()
    state.setToolSize(activeToolId, v)
    // With the Blend tool, "Steps" also retunes any selected LIVE blends.
    if (activeToolId === 'blend') cmdSetBlendSteps(editorStore, state.selection, v)
  }

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
            step={sizeSpec.step ?? 0.25}
            value={toolSize ?? sizeSpec.default}
            onChange={(e) => setSize(parseFloat(e.target.value))}
          />
          <input
            className="tool-size-num"
            type="number"
            min={sizeSpec.min}
            max={sizeSpec.max}
            step={sizeSpec.step ?? 0.25}
            value={toolSize ?? sizeSpec.default}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (!Number.isNaN(v)) setSize(v)
            }}
          />
        </label>
      )}

      {activeToolId === 'paintbrush' && (
        <select
          className="grid-select"
          value={activeBrushId}
          onChange={(e) => editorStore.getState().setActiveBrush(e.target.value)}
          title="Brush (scatter/pattern/art brushes place the active symbol along the path)"
        >
          {BUILTIN_BRUSHES.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      {activeToolId === 'symbol-stainer' && (
        <span className="topbar-hint" title="The Symbol Stainer tints toward the Fill color in the Appearance panel">
          Tints toward the Fill color{currentFill && currentFill.type === 'solid'
            ? ` (${rgbToHex(currentFill.color)})`
            : ''}
        </span>
      )}

      <div className="topbar-spacer" />
    </div>
  )
}
