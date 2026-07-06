/**
 * Color conversions for the Fill/Stroke UI: RGBA <-> HSB and <-> HEX.
 * Pure functions; RGBA stays the single stored representation (model/types).
 * HSB is a UI-only view — h 0-360, s/b 0-100.
 */

import type { RGBA } from './types'

export interface HSB {
  /** 0-360 */
  h: number
  /** 0-100 */
  s: number
  /** 0-100 */
  b: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function clampRGBA(c: RGBA): RGBA {
  return {
    r: clamp(Math.round(c.r), 0, 255),
    g: clamp(Math.round(c.g), 0, 255),
    b: clamp(Math.round(c.b), 0, 255),
    a: clamp(c.a, 0, 1),
  }
}

export function rgbToHsb(c: RGBA): HSB {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : (d / max) * 100
  return { h, s, b: max * 100 }
}

/** Alpha is not part of HSB; pass it through explicitly. */
export function hsbToRgb(hsb: HSB, alpha = 1): RGBA {
  const h = ((hsb.h % 360) + 360) % 360
  const s = clamp(hsb.s, 0, 100) / 100
  const v = clamp(hsb.b, 0, 100) / 100
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return clampRGBA({
    r: (rgb[0] + m) * 255,
    g: (rgb[1] + m) * 255,
    b: (rgb[2] + m) * 255,
    a: alpha,
  })
}

/** #RRGGBB (alpha is edited separately in the UI). */
export function rgbToHex(c: RGBA): string {
  const to2 = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')
  return `#${to2(c.r)}${to2(c.g)}${to2(c.b)}`.toUpperCase()
}

/**
 * Parse #RGB, #RRGGBB, or #RRGGBBAA (leading # optional). Returns null on
 * anything malformed; `alpha` is the fallback when the hex carries none.
 */
export function hexToRgb(hex: string, alpha = 1): RGBA | null {
  const s = hex.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(s)) return null
  if (s.length === 3) {
    const [r, g, b] = s.split('').map((ch) => parseInt(ch + ch, 16))
    return { r: r!, g: g!, b: b!, a: alpha }
  }
  if (s.length === 6 || s.length === 8) {
    const r = parseInt(s.slice(0, 2), 16)
    const g = parseInt(s.slice(2, 4), 16)
    const b = parseInt(s.slice(4, 6), 16)
    const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : alpha
    return { r, g, b, a }
  }
  return null
}

export function rgbaEquals(a: RGBA, b: RGBA, epsilon = 0.001): boolean {
  return (
    Math.abs(a.r - b.r) < 0.5 &&
    Math.abs(a.g - b.g) < 0.5 &&
    Math.abs(a.b - b.b) < 0.5 &&
    Math.abs(a.a - b.a) < epsilon
  )
}

/** Linear interpolation between two colors (gradient stop insertion). */
export function mixRGBA(a: RGBA, b: RGBA, t: number): RGBA {
  return clampRGBA({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  })
}
