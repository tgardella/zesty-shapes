/**
 * Text measurement indirection: layout (model/textLayout.ts) and bbox need
 * string widths, but real measurement is a runtime/DOM concern. The renderer
 * registers a canvas-based measurer at boot (rendering/fontKit.ts); tests and
 * headless code fall back to a deterministic approximation.
 */

export interface FontSpec {
  family: string
  /** px */
  size: number
  weight: number
  kerning: boolean
}

/** Width of `text` in px at the given font. */
export type MeasureFn = (text: string, font: FontSpec) => number

/** Deterministic fallback: average glyph ~0.6em (used in tests/headless). */
export const approximateMeasure: MeasureFn = (text, font) => text.length * font.size * 0.6

let current: MeasureFn = approximateMeasure

export function registerTextMeasurer(fn: MeasureFn): void {
  current = fn
}

export function measureText(text: string, font: FontSpec): number {
  return current(text, font)
}

/** Baseline-to-top distance approximation shared by layout + editor overlay. */
export function ascentOf(size: number): number {
  return size * 0.8
}
