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
  eyedropper: (
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 16 L4.6 13.2 L11 6.8 L13.2 9 L6.8 15.4 Z" strokeLinejoin="round" />
      <path d="M11.8 6 L14 3.8 A1.55 1.55 0 0 1 16.2 6 L14 8.2" fill="currentColor" />
    </g>
  ),
  gradient: (
    <g>
      <defs>
        <linearGradient id="tool-grad-icon" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect x="3.5" y="6" width="13" height="8" fill="url(#tool-grad-icon)" stroke="currentColor" strokeWidth="1.2" />
    </g>
  ),
  width: (
    <g fill="none" stroke="currentColor">
      <path d="M3 13 C 7 5, 13 5, 17 13" strokeWidth="1.2" />
      <path d="M3 13 C 7 9.4, 13 9.4, 17 13" strokeWidth="1.2" />
      <circle cx="10" cy="7" r="1.7" fill="#ffffff" strokeWidth="1.2" />
      <circle cx="10" cy="10.3" r="1.7" fill="#ffffff" strokeWidth="1.2" />
    </g>
  ),
  'shape-builder': (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="5" />
      <circle cx="12.5" cy="12.5" r="5" />
      <path d="M8 10.5 L12.5 10.5" strokeWidth="1.2" />
    </g>
  ),
  knife: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M4 16 C 8 12, 12 8, 16 3" />
      <path d="M4 16 L9 15 L6.2 12.5 Z" fill="currentColor" />
    </g>
  ),
  eraser: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="5.5" y="7.5" width="9" height="6" rx="1" transform="rotate(-35 10 10.5)" />
      <line x1="4" y1="16" x2="13" y2="16" />
    </g>
  ),
  type: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 5.5 L5 4 L15 4 L15 5.5" />
      <line x1="10" y1="4" x2="10" y2="16" />
      <line x1="8" y1="16" x2="12" y2="16" />
    </g>
  ),
  'type-vertical': (
    <g fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4.5 6 L4.5 4.5 L11.5 4.5 L11.5 6" />
      <line x1="8" y1="4.5" x2="8" y2="11" />
      <path d="M15 4 L15 16 M13 14 L15 16 L17 14" />
    </g>
  ),
  'magic-wand': (
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="11.5" y1="8.5" x2="4" y2="16" />
      <path d="M13.5 3 L14.2 5.3 L16.5 6 L14.2 6.7 L13.5 9 L12.8 6.7 L10.5 6 L12.8 5.3 Z" fill="currentColor" stroke="none" />
      <line x1="16.5" y1="9.5" x2="17.5" y2="10.5" />
      <line x1="9.5" y1="2.5" x2="8.5" y2="1.5" />
    </g>
  ),
  lasso: (
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M10 3.5 C 14.5 3.5, 17 5.5, 17 8 C 17 10.5, 13.5 12, 10 12 C 6.5 12, 3.5 10.5, 3.5 8 C 3.5 6, 5.5 4.2, 8.5 3.7" />
      <path d="M7 11.5 C 6 13, 5.5 15, 6.5 17" strokeDasharray="2 1.6" />
    </g>
  ),
  artboard: (
    <g fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5" y="5" width="10" height="10" />
      <line x1="2" y1="5" x2="18" y2="5" strokeWidth="1" opacity="0.65" />
      <line x1="2" y1="15" x2="18" y2="15" strokeWidth="1" opacity="0.65" />
      <line x1="5" y1="2" x2="5" y2="18" strokeWidth="1" opacity="0.65" />
      <line x1="15" y1="2" x2="15" y2="18" strokeWidth="1" opacity="0.65" />
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
