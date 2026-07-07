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
}

export const TOOL_SIZE_SPECS: Record<string, ToolSizeSpec> = {
  pencil: { default: 2, min: 0.25, max: 64, label: 'Stroke' },
  pen: { default: 1, min: 0.25, max: 64, label: 'Stroke' },
  curvature: { default: 1, min: 0.25, max: 64, label: 'Stroke' },
  eraser: { default: 20, min: 2, max: 200, label: 'Size' },
  knife: { default: 6, min: 1, max: 64, label: 'Size' },
  scissors: { default: 12, min: 2, max: 64, label: 'Size' },
}

export function isSizeableTool(toolId: string): boolean {
  return toolId in TOOL_SIZE_SPECS
}

export function defaultToolSize(toolId: string): number {
  return TOOL_SIZE_SPECS[toolId]?.default ?? 0
}
