/**
 * Scale tool (S): drag the selection's bounding-box handles to scale.
 * Anchor = opposite handle; Alt = about center; Shift = constrain aspect.
 * Clicking a node selects it; clicking empty canvas clears the selection.
 */

import { TransformHandleController } from './behaviors/TransformHandleBehavior'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

export class ScaleTool implements Tool {
  readonly id = 'scale'
  readonly name = 'Scale'
  readonly shortcut = 's'
  readonly cursor = 'default'

  private readonly controller = new TransformHandleController()

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.controller.tryBegin(e, ctx, 'scale')) return
    if (e.hitNodeId) {
      if (!ctx.getSelection().includes(e.hitNodeId)) ctx.select.set([e.hitNodeId])
    } else {
      ctx.select.clear()
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
