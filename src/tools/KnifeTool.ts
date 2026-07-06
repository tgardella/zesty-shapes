/**
 * Knife (toolbar): freehand-cut across shapes. Drag a line through objects;
 * on release every intersected filled object splits into SEPARATE closed
 * paths along the cut (thin-blade subtraction through the boolean engine).
 * Cuts the selection when one exists, otherwise everything under the blade.
 * One drag = one 'Knife' undo step.
 */

import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

/** Doc-space spacing between recorded trail points. */
const TRAIL_STEP = 1.5
/** Trails shorter than this (doc units) are ignored as accidental clicks. */
const MIN_TRAIL_LENGTH = 3

export class KnifeTool implements Tool {
  readonly id = 'knife'
  readonly name = 'Knife'
  readonly shortcut = null
  readonly cursor = 'crosshair'

  protected trail: Vec2[] | null = null

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

  onPointerUp(_e: ToolPointerEvent, ctx: ToolContext): void {
    const trail = this.trail
    this.trail = null
    ctx.overlay.setCutTrail(null)
    if (!trail || trailLength(trail) < MIN_TRAIL_LENGTH) return
    this.apply(trail, ctx)
  }

  protected apply(trail: Vec2[], ctx: ToolContext): void {
    const selection = ctx.getSelection()
    ctx.commands.knife(trail, selection.length > 0 ? selection : undefined)
  }

  onCancel(ctx: ToolContext): void {
    this.trail = null
    ctx.overlay.setCutTrail(null)
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}

function trailLength(trail: Vec2[]): number {
  let len = 0
  for (let i = 1; i < trail.length; i++) len += distance(trail[i - 1]!, trail[i]!)
  return len
}
