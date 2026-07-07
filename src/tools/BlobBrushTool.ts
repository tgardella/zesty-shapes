/**
 * Blob Brush (Shift+B): paints FILLED shapes instead of strokes. The drag
 * trail becomes a blob (the trail's round outline at the brush diameter);
 * blobs of the same color merge with the same-colored filled paths they
 * touch — repeated strokes sculpt one shape (store/brushCommands). One drag
 * = one 'Blob Brush' undo step.
 */

import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import type { SolidPaint } from '../model/types'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

const TRAIL_STEP = 1.5

/** Blob color: the current FILL when solid, else the stroke, else black. */
function blobPaint(ctx: ToolContext): SolidPaint {
  const style = ctx.style.current()
  for (const paint of [style.fill, style.stroke]) {
    if (paint && paint.type === 'solid') return { type: 'solid', color: { ...paint.color } }
  }
  return { type: 'solid', color: { r: 30, g: 30, b: 30, a: 1 } }
}

export class BlobBrushTool implements Tool {
  readonly id = 'blob-brush'
  readonly name = 'Blob Brush'
  readonly shortcut = 'shift+b'
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

  onPointerUp(_e: ToolPointerEvent, ctx: ToolContext): void {
    const trail = this.trail
    this.trail = null
    ctx.overlay.setCutTrail(null)
    if (!trail) return
    ctx.commands.blobPaint(trail, ctx.toolSize.get('blob-brush'), blobPaint(ctx))
  }

  onCancel(ctx: ToolContext): void {
    this.trail = null
    ctx.overlay.setCutTrail(null)
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}
