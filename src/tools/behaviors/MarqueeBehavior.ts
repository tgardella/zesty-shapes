/**
 * Shared marquee gesture: tracks the doc-space rectangle from pointer-down,
 * publishes it to the overlay while dragging, and returns the final rect on
 * release (null for a sub-threshold click).
 */

import type { BBox } from '../../geometry/bbox'
import type { Vec2 } from '../../geometry/vec2'
import type { ToolContext, ToolPointerEvent } from '../types'

const MIN_MARQUEE_DOC_AREA = 1e-6

function normalizedRect(a: Vec2, b: Vec2): BBox {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  }
}

export class MarqueeBehavior {
  private origin: Vec2 | null = null
  private moved = false

  get isActive(): boolean {
    return this.origin !== null
  }

  begin(e: ToolPointerEvent): void {
    this.origin = e.docPoint
    this.moved = false
  }

  update(e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.origin) return
    this.moved = true
    ctx.overlay.setMarquee(normalizedRect(this.origin, e.docPoint))
  }

  /** Ends the gesture; returns the rect, or null when it was just a click. */
  end(e: ToolPointerEvent, ctx: ToolContext): BBox | null {
    if (!this.origin) return null
    const rect = normalizedRect(this.origin, e.docPoint)
    this.origin = null
    ctx.overlay.setMarquee(null)
    if (!this.moved) return null
    const area = (rect.maxX - rect.minX) * (rect.maxY - rect.minY)
    return area > MIN_MARQUEE_DOC_AREA ? rect : null
  }

  cancel(ctx: ToolContext): void {
    this.origin = null
    this.moved = false
    ctx.overlay.setMarquee(null)
  }
}
