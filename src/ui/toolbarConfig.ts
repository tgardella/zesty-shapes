/**
 * Toolbar customization state (Window > Customize Toolbar…): which tools show
 * in the left toolbar and in what order. Pure UI preference — lives in its
 * own tiny store persisted to localStorage, never in the document and never
 * undoable.
 */

import { create } from 'zustand'

export const TOOLBAR_CONFIG_KEY = 'zesty-shapes.toolbarConfig'

export interface ToolbarConfig {
  /** Tool ids in display order. Registered tools missing here append at the end. */
  order: string[]
  /** Tool ids hidden from the toolbar (still reachable by shortcut). */
  hidden: string[]
}

interface ToolbarConfigState extends ToolbarConfig {
  setToolHidden(toolId: string, hidden: boolean): void
  /** Move a tool `delta` slots within `allIds` display order (clamped). */
  moveTool(toolId: string, delta: number, allIds: string[]): void
  reset(): void
}

function load(): ToolbarConfig {
  try {
    const raw = localStorage.getItem(TOOLBAR_CONFIG_KEY)
    if (!raw) return { order: [], hidden: [] }
    const parsed = JSON.parse(raw) as Partial<ToolbarConfig>
    return {
      order: Array.isArray(parsed.order) ? parsed.order.filter((v) => typeof v === 'string') : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((v) => typeof v === 'string') : [],
    }
  } catch {
    return { order: [], hidden: [] }
  }
}

function save(config: ToolbarConfig): void {
  try {
    localStorage.setItem(TOOLBAR_CONFIG_KEY, JSON.stringify(config))
  } catch {
    // Storage full/unavailable: the config still applies for this session.
  }
}

/** Registered tool ids resolved against the saved order (unknowns append). */
export function displayOrder(config: ToolbarConfig, registeredIds: string[]): string[] {
  const known = new Set(registeredIds)
  const ordered = config.order.filter((id) => known.has(id))
  const listed = new Set(ordered)
  return [...ordered, ...registeredIds.filter((id) => !listed.has(id))]
}

export const useToolbarConfig = create<ToolbarConfigState>()((set, get) => ({
  ...load(),

  setToolHidden(toolId, hidden) {
    const current = new Set(get().hidden)
    if (hidden) current.add(toolId)
    else current.delete(toolId)
    const next = { order: get().order, hidden: [...current] }
    save(next)
    set(next)
  },

  moveTool(toolId, delta, allIds) {
    const order = displayOrder(get(), allIds)
    const from = order.indexOf(toolId)
    if (from === -1) return
    const to = Math.max(0, Math.min(order.length - 1, from + delta))
    if (to === from) return
    order.splice(from, 1)
    order.splice(to, 0, toolId)
    const next = { order, hidden: get().hidden }
    save(next)
    set(next)
  },

  reset() {
    const next = { order: [], hidden: [] }
    save(next)
    set(next)
  },
}))
