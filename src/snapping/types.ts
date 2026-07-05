/**
 * Snapping interfaces. Thresholds are specified in SCREEN pixels and divided
 * by zoom inside each snapper, so snapping feels identical at any zoom.
 * All points and guides are in DOCUMENT space.
 */

import type { Vec2 } from '../geometry/vec2'

/** A guide line rendered by the overlay while a snap is active (doc space). */
export interface SnapGuide {
  a: Vec2
  b: Vec2
}

/** Settings snapshot (from the ui slice). */
export interface SnapSettings {
  snapToGrid: boolean
  gridSize: number
}

export interface SnapQuery {
  zoom: number
  /** Gesture origin (pointer-down doc point); null outside a gesture. */
  anchor: Vec2 | null
  /** True when Shift-constrain applies (tool opted in and Shift is held). */
  constrainAngle: boolean
}

export interface SnapResult {
  point: Vec2
  guides: SnapGuide[]
}

export interface Snapper {
  id: string
  /** Return null when this snapper doesn't apply; otherwise the adjusted point. */
  snap(point: Vec2, query: SnapQuery, settings: SnapSettings): SnapResult | null
}

/**
 * RESERVED SEAM: future "smart guide" snapping (object bounds, anchor points,
 * centers) plugs in as additional providers — the engine and tool pipeline
 * never change, providers just contribute more snappers.
 */
export interface SnapProvider {
  id: string
  getSnappers(): Snapper[]
}
