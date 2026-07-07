/**
 * Reflect tool (O): drag to define the mirror axis through the selection's
 * bbox center — the selection reflects across the vector from the center to
 * the pointer. Shift snaps the axis to 45° steps. Clicking an unselected node
 * selects it first; empty canvas clears.
 */

import { TransformHandleController } from './behaviors/TransformHandleBehavior'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

export class ReflectTool implements Tool {
  readonly id = 'reflect'
  readonly name = 'Reflect'
  readonly shortcut = 'o'
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
    this.controller.beginMode('reflect', e, ctx)
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
