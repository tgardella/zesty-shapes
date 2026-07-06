/**
 * Eraser (Shift+E): freehand-remove path regions. The drag trail becomes a
 * round blob (stroke outline at the eraser diameter) subtracted from every
 * filled object it touches — selection when one exists, everything otherwise.
 * Objects erased to nothing are deleted; pieces survive as compound
 * subpaths. One drag = one 'Erase' undo step.
 */

import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

const TRAIL_STEP = 1.5
/** Eraser radius in DOC units. */
export const ERASER_RADIUS = 8

export class EraserTool implements Tool {
  readonly id = 'eraser'
  readonly name = 'Eraser'
  readonly shortcut = 'shift+e'
  readonly cursor = 'crosshair'

  private trail: Vec2[] | null = null

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    this.trail = [e.docPoint]
    ctx.overlay.setCutTrail(this.trail)
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.trail) return
    const last = this.trail[this.trail.length - 1]!
    if (distance(last, e.docPoint) < TRAIL_STEP) return
    this.trail = [...this.trail, e.docPoint]
    ctx.overlay.setCutTrail(this.trail)
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    let trail = this.trail
    this.trail = null
    ctx.overlay.setCutTrail(null)
    if (!trail) return
    // A bare click still erases a dot: give the blade two nearby points.
    if (trail.length < 2) trail = [trail[0]!, { x: e.docPoint.x + 0.1, y: e.docPoint.y }]
    const selection = ctx.getSelection()
    ctx.commands.erase(trail, ERASER_RADIUS, selection.length > 0 ? selection : undefined)
  }

  onCancel(ctx: ToolContext): void {
    this.trail = null
    ctx.overlay.setCutTrail(null)
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}
