/**
 * Per-tool size metadata (the size selector + cursor circle). Size is a
 * DIAMETER in document units. What it means is per-tool:
 * - pencil / pen / paintbrush-family: stroke width of the created path
 * - eraser: diameter of the erasing blob
 * - knife / scissors: hit/snap tolerance band around the blade or path
 * Tools not listed here have no size — the selector and cursor circle hide.
 */

export interface ToolSizeSpec {
  /** Default diameter, doc units. */
  default: number
  min: number
  max: number
  label: string
  /** Hide the on-canvas size cursor circle (e.g. Blend "Steps" isn't a size). */
  cursor?: boolean
  /** Selector increment; default 0.25. Integer-valued sizes use 1. */
  step?: number
}

export const TOOL_SIZE_SPECS: Record<string, ToolSizeSpec> = {
  pencil: { default: 2, min: 0.25, max: 64, label: 'Stroke' },
  pen: { default: 1, min: 0.25, max: 64, label: 'Stroke' },
  curvature: { default: 1, min: 0.25, max: 64, label: 'Stroke' },
  eraser: { default: 20, min: 2, max: 200, label: 'Size' },
  knife: { default: 6, min: 1, max: 64, label: 'Size' },
  scissors: { default: 12, min: 2, max: 64, label: 'Size' },
  paintbrush: { default: 6, min: 0.5, max: 64, label: 'Size' },
  'blob-brush': { default: 16, min: 1, max: 200, label: 'Size' },
  'symbol-sprayer': { default: 80, min: 16, max: 400, label: 'Size' },
  'symbol-shifter': { default: 100, min: 16, max: 400, label: 'Size' },
  'symbol-scruncher': { default: 100, min: 16, max: 400, label: 'Size' },
  'symbol-sizer': { default: 100, min: 16, max: 400, label: 'Size' },
  'symbol-stainer': { default: 100, min: 16, max: 400, label: 'Size' },
  blend: { default: 5, min: 1, max: 24, label: 'Steps', cursor: false, step: 1 },
}

export function isSizeableTool(toolId: string): boolean {
  return toolId in TOOL_SIZE_SPECS
}

export function defaultToolSize(toolId: string): number {
  return TOOL_SIZE_SPECS[toolId]?.default ?? 0
}
