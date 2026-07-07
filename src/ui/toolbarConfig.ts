/**
 * Toolbar customization state (Window > Customize Toolbar…): which tools show
 * in the left toolbar, in what order, and which member of each click+hold
 * TOOL GROUP was used last (the group's slot shows that tool). Pure UI
 * preference — lives in its own tiny store persisted to localStorage, never
 * in the document and never undoable.
 */

import { create } from 'zustand'

export const TOOLBAR_CONFIG_KEY = 'zesty-shapes.toolbarConfig'

/**
 * Click+hold tool groups (Illustrator's nested toolbar slots). Each inner
 * array is one slot; holding (or right-clicking) the slot opens a flyout of
 * its members. Registered tools not listed here get a singleton slot.
 */
export const TOOL_GROUPS: readonly (readonly string[])[] = [
  ['selection'],
  ['direct-selection', 'lasso', 'magic-wand'],
  ['pen', 'curvature'],
  ['pencil'],
  ['paintbrush', 'blob-brush'],
  ['rectangle', 'rounded-rect', 'ellipse', 'polygon', 'star', 'line'],
  ['type', 'type-vertical'],
  ['scale', 'rotate'],
  ['eraser', 'scissors', 'knife'],
  ['width'],
  ['shape-builder'],
  ['gradient'],
  ['gradient-mesh'],
  ['eyedropper'],
  ['blend'],
  ['symbol-sprayer'],
  ['artboard'],
]

/** Group key = its first member (stable across sessions). */
export function groupKeyOf(toolId: string): string {
  for (const group of TOOL_GROUPS) if (group.includes(toolId)) return group[0]!
  return toolId
}

export interface ToolbarConfig {
  /** Tool ids in display order. Registered tools missing here append at the end. */
  order: string[]
  /** Tool ids hidden from the toolbar (still reachable by shortcut). */
  hidden: string[]
  /** Last-used member per group key (that tool fronts the group's slot). */
  groupCurrent: Record<string, string>
}

interface ToolbarConfigState extends ToolbarConfig {
  setToolHidden(toolId: string, hidden: boolean): void
  /** Move a tool `delta` slots within `allIds` display order (clamped). */
  moveTool(toolId: string, delta: number, allIds: string[]): void
  /** Remember `toolId` as its group's front tool. */
  setGroupCurrent(toolId: string): void
  reset(): void
}

function load(): ToolbarConfig {
  try {
    const raw = localStorage.getItem(TOOLBAR_CONFIG_KEY)
    if (!raw) return { order: [], hidden: [], groupCurrent: {} }
    const parsed = JSON.parse(raw) as Partial<ToolbarConfig>
    const groupCurrent: Record<string, string> = {}
    if (parsed.groupCurrent && typeof parsed.groupCurrent === 'object') {
      for (const [k, v] of Object.entries(parsed.groupCurrent)) {
        if (typeof v === 'string') groupCurrent[k] = v
      }
    }
    return {
      order: Array.isArray(parsed.order) ? parsed.order.filter((v) => typeof v === 'string') : [],
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((v) => typeof v === 'string') : [],
      groupCurrent,
    }
  } catch {
    return { order: [], hidden: [], groupCurrent: {} }
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
export function displayOrder(
  config: Pick<ToolbarConfig, 'order' | 'hidden'>,
  registeredIds: string[],
): string[] {
  const known = new Set(registeredIds)
  const ordered = config.order.filter((id) => known.has(id))
  const listed = new Set(ordered)
  return [...ordered, ...registeredIds.filter((id) => !listed.has(id))]
}

export interface ToolbarSlot {
  /** Group key (the group's first member). */
  key: string
  /** VISIBLE members in display order (flyout order). */
  toolIds: string[]
  /** The member fronting the slot (last used, falling back to first visible). */
  currentId: string
}

/**
 * The toolbar's slots: visible tools bucketed into their click+hold groups,
 * slots ordered by their first visible member's position in the display
 * order. A group with every member hidden has no slot.
 */
export function toolbarSlots(config: ToolbarConfig, registeredIds: string[]): ToolbarSlot[] {
  const hidden = new Set(config.hidden)
  const visible = displayOrder(config, registeredIds).filter((id) => !hidden.has(id))
  const slots = new Map<string, string[]>()
  for (const id of visible) {
    const key = groupKeyOf(id)
    const members = slots.get(key)
    if (members) members.push(id)
    else slots.set(key, [id])
  }
  return [...slots.entries()].map(([key, toolIds]) => {
    const remembered = config.groupCurrent[key]
    return {
      key,
      toolIds,
      currentId: remembered && toolIds.includes(remembered) ? remembered : toolIds[0]!,
    }
  })
}

export const useToolbarConfig = create<ToolbarConfigState>()((set, get) => ({
  ...load(),

  setToolHidden(toolId, hidden) {
    const current = new Set(get().hidden)
    if (hidden) current.add(toolId)
    else current.delete(toolId)
    const next = { order: get().order, hidden: [...current], groupCurrent: get().groupCurrent }
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
    const next = { order, hidden: get().hidden, groupCurrent: get().groupCurrent }
    save(next)
    set(next)
  },

  setGroupCurrent(toolId) {
    const key = groupKeyOf(toolId)
    if (get().groupCurrent[key] === toolId) return
    const next = {
      order: get().order,
      hidden: get().hidden,
      groupCurrent: { ...get().groupCurrent, [key]: toolId },
    }
    save(next)
    set(next)
  },

  reset() {
    const next = { order: [], hidden: [], groupCurrent: {} }
    save(next)
    set(next)
  },
}))
