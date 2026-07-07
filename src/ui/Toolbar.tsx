/**
 * Left toolbar: two Illustrator-style columns of tool SLOTS. Related tools
 * share a slot (click+hold groups, ui/toolbarConfig.TOOL_GROUPS): the slot
 * shows the group's last-used member with a corner triangle; click+HOLD (or
 * right-click) opens a flyout to switch members. Which tools show — and
 * their order — comes from the toolbar config (Window > Customize Toolbar…);
 * hidden tools stay reachable through their shortcuts.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useEditor } from '../store/store'
import type { ToolManager } from '../tools/ToolManager'
import { toolbarSlots, useToolbarConfig } from './toolbarConfig'

/** Hold this long on a slot to open its flyout (ms). */
const HOLD_MS = 250

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
  paintbrush: (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M11.5 3.5 L16.5 8.5 L9 16 C7.5 17.5 4.5 17 4 16.5 C5.5 15.5 4.5 13.5 5.5 12.5 Z" strokeLinejoin="round" />
      <line x1="13" y1="5" x2="15" y2="7" />
    </g>
  ),
  'blob-brush': (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M4 12 C 3 8, 7 5, 10 6.5 C 13 4.5, 17 7, 16 10.5 C 17.5 13, 15 16, 12 15 C 9.5 17, 5 15.5, 5.5 13 C 4.5 13, 4 12.5, 4 12 Z" strokeLinejoin="round" />
    </g>
  ),
  blend: (
    <g fill="none" stroke="currentColor">
      <circle cx="5.5" cy="14" r="3" strokeWidth="1.5" />
      <circle cx="14.5" cy="6" r="3" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="3" strokeWidth="1" opacity="0.55" strokeDasharray="2 1.6" />
    </g>
  ),
  'gradient-mesh': (
    <g fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M4 4 C 8 5.5, 12 5.5, 16 4 L16 16 C 12 14.5, 8 14.5, 4 16 Z" />
      <path d="M10 4.9 L10 15.1 M4 10 C 8 11.2, 12 11.2, 16 10" strokeWidth="1" />
      <circle cx="10" cy="10.6" r="1.4" fill="currentColor" stroke="none" />
    </g>
  ),
  'symbol-sprayer': (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M6 17 L6 9 L10 9 L10 17 Z M7 9 L7 6.5 L9 6.5 L9 9" />
      <circle cx="12.5" cy="5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="3.5" r="0.9" fill="currentColor" stroke="none" />
    </g>
  ),
  'symbol-shifter': (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="6.5" cy="10" r="2" />
      <circle cx="13" cy="10" r="2" opacity="0.5" />
      <path d="M9 10 L12 10 M11 8.5 L12.5 10 L11 11.5" strokeWidth="1.2" />
    </g>
  ),
  'symbol-scruncher': (
    <g fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />
      <path d="M4 4 L7 7 M16 4 L13 7 M4 16 L7 13 M16 16 L13 13" />
    </g>
  ),
  'symbol-sizer': (
    <g fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="12" r="2.4" />
      <circle cx="14" cy="7" r="3.4" opacity="0.7" />
    </g>
  ),
  'symbol-stainer': (
    <g fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M12 3 L15 6 L8 13 L5 13 L5 10 Z" />
      <path d="M5 16 L15 16" strokeWidth="1.6" />
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

/** The tool's toolbar icon (shared with the Customize Toolbar dialog). */
export function ToolIcon({ toolId, name }: { toolId: string; name: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      {ICONS[toolId] ?? (
        <text x="10" y="14" textAnchor="middle" fontSize="11" fill="currentColor">
          {name.charAt(0)}
        </text>
      )}
    </svg>
  )
}

interface FlyoutState {
  slotKey: string
  /** Screen position of the slot button (flyout anchors beside it). */
  top: number
  left: number
}

export function Toolbar({ manager }: { manager: ToolManager }) {
  const activeToolId = useEditor((s) => s.tool.activeToolId)
  const order = useToolbarConfig((s) => s.order)
  const hidden = useToolbarConfig((s) => s.hidden)
  const groupCurrent = useToolbarConfig((s) => s.groupCurrent)
  const setGroupCurrent = useToolbarConfig((s) => s.setGroupCurrent)
  const [flyout, setFlyout] = useState<FlyoutState | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressClick = useRef(false)

  const tools = manager.getTools()
  const byId = new Map(tools.map((t) => [t.id, t]))
  const slots = toolbarSlots({ order, hidden, groupCurrent }, tools.map((t) => t.id))

  // Activating a tool by SHORTCUT also fronts it in its group's slot.
  useEffect(() => {
    setGroupCurrent(activeToolId)
  }, [activeToolId, setGroupCurrent])

  const clearHold = (): void => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }

  const openFlyout = (slotKey: string, button: HTMLElement): void => {
    const rect = button.getBoundingClientRect()
    setFlyout({ slotKey, top: rect.top, left: rect.right + 4 })
  }

  const pick = (toolId: string): void => {
    manager.setActiveTool(toolId)
    setGroupCurrent(toolId)
    setFlyout(null)
  }

  const flyoutSlot = flyout ? slots.find((s) => s.key === flyout.slotKey) : undefined

  return (
    <div className="toolbar">
      {slots.map((slot) => {
        const current = byId.get(slot.currentId)!
        const isActive = slot.toolIds.includes(activeToolId)
        // The slot fronts the ACTIVE member while one is active.
        const front = isActive ? byId.get(activeToolId)! : current
        return (
          <button
            key={slot.key}
            type="button"
            className={`tool-btn${isActive ? ' active' : ''}`}
            title={
              front.shortcut ? `${front.name} (${front.shortcut.toUpperCase()})` : front.name
            }
            onPointerDown={(e) => {
              if (slot.toolIds.length < 2) return
              suppressClick.current = false
              const button = e.currentTarget
              clearHold()
              holdTimer.current = setTimeout(() => {
                holdTimer.current = null
                suppressClick.current = true
                openFlyout(slot.key, button)
              }, HOLD_MS)
            }}
            onPointerUp={clearHold}
            onPointerLeave={clearHold}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false
                return
              }
              manager.setActiveTool(front.id)
              setGroupCurrent(front.id)
            }}
            onContextMenu={(e) => {
              if (slot.toolIds.length < 2) return
              e.preventDefault()
              clearHold()
              openFlyout(slot.key, e.currentTarget)
            }}
          >
            <ToolIcon toolId={front.id} name={front.name} />
            {slot.toolIds.length > 1 && <span className="tool-flyout-mark" aria-hidden="true" />}
          </button>
        )
      })}

      {flyout && flyoutSlot && (
        <>
          <div className="menu-backdrop" onPointerDown={() => setFlyout(null)} />
          <div className="tool-flyout" style={{ top: flyout.top, left: flyout.left }}>
            {flyoutSlot.toolIds.map((id) => {
              const tool = byId.get(id)!
              return (
                <button
                  key={id}
                  type="button"
                  className={id === activeToolId ? 'active' : ''}
                  onClick={() => pick(id)}
                  // pointerup also picks: press-hold-release-over-item flow.
                  onPointerUp={() => pick(id)}
                >
                  <ToolIcon toolId={id} name={tool.name} />
                  <span className="tool-flyout-name">{tool.name}</span>
                  {tool.shortcut && (
                    <span className="tool-flyout-shortcut">{tool.shortcut.toUpperCase()}</span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
