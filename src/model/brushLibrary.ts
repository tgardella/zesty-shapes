/**
 * Brush library (Paintbrush, B). A brush is either a STROKE brush — a plain
 * variable-width stroke shaped by a width profile (tools/PaintbrushTool
 * brushWidthProfile) — or an ARTWORK brush that places copies of a piece of
 * art along the drawn path:
 *   - scatter: copies scattered along the path with position/scale/rotation jitter
 *   - pattern: copies tiled evenly along the path, rotated to follow it
 *   - art:     one artwork stretched + bent to follow the whole path
 * Artwork brushes use the active Symbols-panel symbol as their art, falling
 * back to a solid dot (scatter/pattern) or a plain stroke (art).
 */

import type { BrushPreset } from '../store/store'

export type BrushKind = 'stroke' | 'scatter' | 'pattern' | 'art'

export interface BrushDef {
  id: string
  name: string
  kind: BrushKind
  /** Stroke brushes: which width profile shapes the stroke. */
  profile?: BrushPreset
  /** Artwork brushes: gap between copies as a multiple of the artwork size. */
  spacing?: number
  /** Scatter: max +/- fraction of random size variation (0 = none). */
  scaleJitter?: number
  /** Scatter: max +/- random rotation, radians (0 = none). */
  rotationJitter?: number
  /** Rotate each copy (and the art brush) to the path tangent. */
  followPath?: boolean
}

export const BUILTIN_BRUSHES: readonly BrushDef[] = [
  { id: 'basic', name: 'Basic', kind: 'stroke', profile: 'uniform' },
  { id: 'taper', name: 'Tapered', kind: 'stroke', profile: 'taper' },
  { id: 'calligraphic', name: 'Calligraphic', kind: 'stroke', profile: 'calligraphic' },
  {
    id: 'scatter',
    name: 'Scatter',
    kind: 'scatter',
    spacing: 1.4,
    scaleJitter: 0.5,
    rotationJitter: Math.PI,
    followPath: false,
  },
  {
    id: 'scatter-follow',
    name: 'Scatter (Follow)',
    kind: 'scatter',
    spacing: 0.8,
    scaleJitter: 0.3,
    rotationJitter: 0.5,
    followPath: true,
  },
  { id: 'pattern', name: 'Pattern', kind: 'pattern', spacing: 1.05, followPath: true },
  { id: 'art', name: 'Art (Stretch)', kind: 'art', followPath: true },
]

export const DEFAULT_BRUSH_ID = 'taper'

/** The brush for `id`, falling back to the default when unknown. */
export function brushById(id: string): BrushDef {
  return (
    BUILTIN_BRUSHES.find((b) => b.id === id) ??
    BUILTIN_BRUSHES.find((b) => b.id === DEFAULT_BRUSH_ID)!
  )
}
