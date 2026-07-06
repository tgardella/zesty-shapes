/**
 * Shared drag gesture: threshold arming + optional transaction lifecycle.
 * Below the pixel threshold a pointer-up is a CLICK; above it, the gesture
 * becomes a drag, `transactionLabel` (if set) opens a transaction at drag
 * start, and pointer-up commits it — one gesture, one undo step.
 * onEnd runs BEFORE the commit so tools can set selection into the entry.
 */

import type { ToolContext, ToolPointerEvent } from '../types'

export interface DragHandlers {
  /** Static label, or a function evaluated when the drag threshold is crossed. */
  transactionLabel?: string | ((e: ToolPointerEvent) => string)
  onStart?(e: ToolPointerEvent, ctx: ToolContext): void
  onMove?(e: ToolPointerEvent, ctx: ToolContext): void
  onEnd?(e: ToolPointerEvent, ctx: ToolContext): void
  onClick?(e: ToolPointerEvent, ctx: ToolContext): void
}

export const DEFAULT_DRAG_THRESHOLD_PX = 3

export class DragBehavior {
  private armed = false
  private dragging = false

  constructor(
    private readonly handlers: DragHandlers,
    private readonly thresholdPx: number = DEFAULT_DRAG_THRESHOLD_PX,
  ) {}

  get isDragging(): boolean {
    return this.dragging
  }

  get isArmed(): boolean {
    return this.armed
  }

  down(_e: ToolPointerEvent): void {
    this.armed = true
    this.dragging = false
  }

  move(e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.armed) return
    if (!this.dragging) {
      const d = e.screenDeltaFromDown
      if (Math.hypot(d.x, d.y) < this.thresholdPx) return
      this.dragging = true
      const label = this.handlers.transactionLabel
      if (label) ctx.transaction.begin(typeof label === 'function' ? label(e) : label)
      this.handlers.onStart?.(e, ctx)
    }
    this.handlers.onMove?.(e, ctx)
  }

  up(e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.armed) return
    const wasDragging = this.dragging
    this.reset()
    if (wasDragging) {
      this.handlers.onEnd?.(e, ctx)
      // No-op if the tool already cancelled (e.g. degenerate result).
      if (this.handlers.transactionLabel) ctx.transaction.commit()
    } else {
      this.handlers.onClick?.(e, ctx)
    }
  }

  cancel(ctx: ToolContext): void {
    const wasDragging = this.dragging
    this.reset()
    if (wasDragging && this.handlers.transactionLabel) ctx.transaction.cancel()
  }

  private reset(): void {
    this.armed = false
    this.dragging = false
  }
}
