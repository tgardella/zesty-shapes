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
  'rounded-rect': (
    <rect
      x="4"
      y="6"
      width="12"
      height="9"
      rx="3.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    />
  ),
  ellipse: (
    <ellipse cx="10" cy="10.5" rx="6" ry="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
  ),
  polygon: (
    <path
      d="M10 3.5 L16 8 L13.7 15.5 L6.3 15.5 L4 8 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  ),
  star: (
    <path
      d="M10 3 L11.8 7.6 L16.5 7.9 L12.9 10.9 L14.1 15.5 L10 12.9 L5.9 15.5 L7.1 10.9 L3.5 7.9 L8.2 7.6 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  ),
  line: <line x1="4.5" y1="15.5" x2="15.5" y2="4.5" stroke="currentColor" strokeWidth="1.8" />,
  'direct-selection': (
    // Hollow arrow cursor
    <path
      d="M5 2 L5 16 L8.5 12.5 L11 18 L13 17 L10.5 11.5 L15 11 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    />
  ),
  pen: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M10 2.5 L13.5 12 L10 15.5 L6.5 12 Z" strokeLinejoin="round" />
      <circle cx="10" cy="11" r="1.4" />
      <line x1="10" y1="2.5" x2="10" y2="6.5" />
    </g>
  ),
  curvature: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M3 14 C 7 4, 13 4, 17 14" />
      <circle cx="3" cy="14" r="1.6" fill="currentColor" />
      <circle cx="10" cy="6.6" r="1.6" fill="#ffffff00" />
      <circle cx="17" cy="14" r="1.6" fill="currentColor" />
    </g>
  ),
  pencil: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M4 16 L4.8 12.5 L13 4.2 A1.6 1.6 0 0 1 15.3 6.5 L7.2 14.8 Z" strokeLinejoin="round" />
      <line x1="12" y1="5.2" x2="14.3" y2="7.5" />
    </g>
  ),
  scissors: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="5.5" cy="14.5" r="2" />
      <circle cx="14.5" cy="14.5" r="2" />
      <line x1="6.8" y1="13" x2="13" y2="3.5" />
      <line x1="13.2" y1="13" x2="7" y2="3.5" />
    </g>
  ),
  scale: (
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3.5" y="8.5" width="8" height="8" />
      <path d="M9 7 L16 7 L16 14" strokeDasharray="2 1.6" />
      <path d="M12.5 3.5 L16.5 3.5 L16.5 7.5 M16.5 3.5 L11 9" strokeDasharray="none" />
    </g>
  ),
  rotate: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M15.5 10 A5.5 5.5 0 1 1 10 4.5" />
      <path d="M10 1.5 L13 4.5 L10 7.5" fill="none" />
    </g>
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
