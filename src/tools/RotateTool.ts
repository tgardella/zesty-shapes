/**
 * Rotate tool (R): drag anywhere (or the rotation knob) to rotate the
 * selection about its bbox center. Shift snaps to 45° steps. Clicking an
 * unselected node selects it first; empty canvas clears.
 */

import { TransformHandleController } from './behaviors/TransformHandleBehavior'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

export class RotateTool implements Tool {
  readonly id = 'rotate'
  readonly name = 'Rotate'
  readonly shortcut = 'r'
  readonly cursor = 'default'

  private readonly controller = new TransformHandleController()

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    const selection = ctx.getSelection()
    if (e.hitNodeId && !selection.includes(e.hitNodeId)) {
      ctx.select.set([e.hitNodeId])
      return
    }
    if (selection.length === 0) {
      ctx.select.clear()
      return
    }
    // Knob or anywhere: both rotate about the selection center.
    if (!this.controller.tryBegin(e, ctx, 'rotate')) {
      this.controller.beginRotate(e, ctx)
    }
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    this.controller.move(e, ctx)
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    this.controller.up(e, ctx)
  }

  onCancel(ctx: ToolContext): void {
    this.controller.cancel(ctx)
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}
