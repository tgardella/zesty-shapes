/**
 * The two core snappers for 0b. Both are pure and stateless.
 */

import type { Vec2 } from '../geometry/vec2'
import type { SnapQuery, SnapResult, SnapSettings, Snapper } from './types'

/** Screen-pixel pull radius for grid snapping (divided by zoom per query). */
export const GRID_SNAP_THRESHOLD_PX = 6

/**
 * Snaps each axis independently to the nearest grid line when within the
 * threshold. Emits no guides — the snapped position itself is the feedback.
 */
export const gridSnapper: Snapper = {
  id: 'grid',
  snap(point: Vec2, query: SnapQuery, settings: SnapSettings): SnapResult | null {
    if (!settings.snapToGrid || settings.gridSize <= 0) return null
    const threshold = GRID_SNAP_THRESHOLD_PX / query.zoom
    const g = settings.gridSize
    const gx = Math.round(point.x / g) * g
    const gy = Math.round(point.y / g) * g
    const snapX = Math.abs(point.x - gx) <= threshold
    const snapY = Math.abs(point.y - gy) <= threshold
    if (!snapX && !snapY) return null
    return {
      point: { x: snapX ? gx : point.x, y: snapY ? gy : point.y },
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
