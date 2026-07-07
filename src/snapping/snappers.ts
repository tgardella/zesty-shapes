/**
 * The two core snappers for 0b. Both are pure and stateless.
 */

import type { Vec2 } from '../geometry/vec2'
import type { SnapQuery, SnapResult, SnapSettings, Snapper } from './types'

/** Quantize a point to the nearest grid intersection. */
export function snapPointToGrid(point: Vec2, gridSize: number): Vec2 {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  }
}

/**
 * The move delta that lands a reference point (e.g. an object's bbox top-left)
 * on the grid after a raw cursor delta. Snapping the OBJECT — not the cursor —
 * is what makes a dragged object align to the grid regardless of where it was
 * grabbed.
 */
export function gridAlignedDelta(ref: Vec2, rawDelta: Vec2, gridSize: number): Vec2 {
  const snapped = snapPointToGrid({ x: ref.x + rawDelta.x, y: ref.y + rawDelta.y }, gridSize)
  return { x: snapped.x - ref.x, y: snapped.y - ref.y }
}

/**
 * Snap-to-grid LOCKS to the grid (Illustrator semantics): every point
 * quantizes to the nearest grid intersection, so drawing and moving land on
 * grid lines regardless of distance. Emits no guides — the snapped position
 * itself is the feedback.
 */
export const gridSnapper: Snapper = {
  id: 'grid',
  snap(point: Vec2, _query: SnapQuery, settings: SnapSettings): SnapResult | null {
    if (!settings.snapToGrid || settings.gridSize <= 0) return null
    return { point: snapPointToGrid(point, settings.gridSize), guides: [] }
  },
}

/**
 * Shift-constrain: projects the point onto the nearest 45° ray from the
 * gesture anchor. Runs AFTER other snappers so the constraint always wins.
 */
export const angleSnapper: Snapper = {
  id: 'angle',
  snap(point: Vec2, query: SnapQuery): SnapResult | null {
    if (!query.constrainAngle || query.anchor === null) return null
    const a = query.anchor
    const dx = point.x - a.x
    const dy = point.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) return null
    const step = Math.PI / 4
    const snapped = Math.round(Math.atan2(dy, dx) / step) * step
    const dir = { x: Math.cos(snapped), y: Math.sin(snapped) }
    const t = dx * dir.x + dy * dir.y // projection onto the constrained ray
    const p = { x: a.x + dir.x * t, y: a.y + dir.y * t }
    return { point: p, guides: [{ a: { ...a }, b: p }] }
  },
}
