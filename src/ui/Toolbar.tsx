/**
 * Left toolbar: one button per registered tool, active state from the store,
 * shortcut in the tooltip.
 */

import type { ReactNode } from 'react'
import { useEditor } from '../store/store'
import type { ToolManager } from '../tools/ToolManager'

const ICONS: Record<string, ReactNode> = {
  selection: (
    // Arrow cursor
    <path d="M5 2 L5 16 L8.5 12.5 L11 18 L13 17 L10.5 11.5 L15 11 Z" fill="currentColor" />
  ),
  rectangle: (
    <rect x="4" y="6" width="12" height="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
  ),
}

export function Toolbar({ manager }: { manager: ToolManager }) {
  const activeToolId = useEditor((s) => s.tool.activeToolId)
  return (
    <div className="toolbar">
      {manager.getTools().map((tool) => (
        <button
          key={tool.id}
          type="button"
          className={`tool-btn${tool.id === activeToolId ? ' active' : ''}`}
          title={tool.shortcut ? `${tool.name} (${tool.shortcut.toUpperCase()})` : tool.name}
          onClick={() => manager.setActiveTool(tool.id)}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            {ICONS[tool.id] ?? (
              <text x="10" y="14" textAnchor="middle" fontSize="11" fill="currentColor">
                {tool.name.charAt(0)}
              </text>
            )}
          </svg>
        </button>
      ))}
    </div>
  )
}
