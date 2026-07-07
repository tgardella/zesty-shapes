/**
 * Customize Toolbar dialog (Window > Customize Toolbar…): choose which tools
 * appear in the left toolbar and reorder them — drag rows, or use the ↑/↓
 * buttons. Changes apply live and persist in localStorage (ui/toolbarConfig).
 * Hidden tools stay reachable through their keyboard shortcuts.
 */

import { useState } from 'react'
import type { ToolManager } from '../tools/ToolManager'
import { ToolIcon } from './Toolbar'
import { displayOrder, useToolbarConfig } from './toolbarConfig'

export function CustomizeToolbarDialog({
  manager,
  onClose,
}: {
  manager: ToolManager
  onClose: () => void
}) {
  const order = useToolbarConfig((s) => s.order)
  const hidden = useToolbarConfig((s) => s.hidden)
  const setToolHidden = useToolbarConfig((s) => s.setToolHidden)
  const moveTool = useToolbarConfig((s) => s.moveTool)
  const reset = useToolbarConfig((s) => s.reset)
  const [dragId, setDragId] = useState<string | null>(null)

  const tools = manager.getTools()
  const byId = new Map(tools.map((t) => [t.id, t]))
  const allIds = tools.map((t) => t.id)
  const ordered = displayOrder({ order, hidden }, allIds)
  const hiddenSet = new Set(hidden)

  const dropOn = (targetId: string): void => {
    if (!dragId || dragId === targetId) return
    const from = ordered.indexOf(dragId)
    const to = ordered.indexOf(targetId)
    if (from !== -1 && to !== -1) moveTool(dragId, to - from, allIds)
  }

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div
        className="dialog customize-toolbar-dialog"
        role="dialog"
        aria-label="Customize Toolbar"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-title">Customize Toolbar</div>
        <div className="dialog-hint">
          Check a tool to show it. Drag rows (or use ↑ ↓) to reorder. Hidden tools keep their
          keyboard shortcuts.
        </div>
        <div className="customize-tool-list">
          {ordered.map((id, index) => {
            const tool = byId.get(id)
            if (!tool) return null
            return (
              <div
                key={id}
                className={`customize-tool-row${dragId === id ? ' dragging' : ''}`}
                draggable
                onDragStart={() => setDragId(id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  dropOn(id)
                  setDragId(null)
                }}
              >
                <span className="drag-grip" aria-hidden="true">
                  ⠿
                </span>
                <label className="customize-tool-label">
                  <input
                    type="checkbox"
                    checked={!hiddenSet.has(id)}
                    onChange={(e) => setToolHidden(id, !e.target.checked)}
                  />
                  <ToolIcon toolId={id} name={tool.name} />
                  <span className="customize-tool-name">{tool.name}</span>
                </label>
                {tool.shortcut && (
                  <span className="customize-tool-shortcut">{tool.shortcut.toUpperCase()}</span>
                )}
                <button
                  type="button"
                  className="row-move"
                  disabled={index === 0}
                  title="Move up"
                  onClick={() => moveTool(id, -1, allIds)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="row-move"
                  disabled={index === ordered.length - 1}
                  title="Move down"
                  onClick={() => moveTool(id, 1, allIds)}
                >
                  ↓
                </button>
              </div>
            )
          })}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={reset}>
            Reset to Default
          </button>
          <div className="dialog-actions-spacer" />
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
