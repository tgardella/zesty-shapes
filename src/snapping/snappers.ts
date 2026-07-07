/**
 * The two core snappers for 0b. Both are pure and stateless.
 */

import type { Vec2 } from '../geometry/vec2'
import type { SnapQuery, SnapResult, SnapSettings, Snapper } from './types'

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
    const g = settings.gridSize
    return {
      point: { x: Math.round(point.x / g) * g, y: Math.round(point.y / g) * g },
      guides: [],
    }
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
