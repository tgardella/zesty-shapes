/**
 * Shear tool: drag to skew the selection about its bbox center. A horizontal
 * drag shears along X (x += k·y); Shift shears along Y instead. Clicking an
 * unselected node selects it first; empty canvas clears. Toolbar-grouped with
 * Scale/Rotate/Reflect (no default keyboard shortcut — those keys are taken).
 */

import { TransformHandleController } from './behaviors/TransformHandleBehavior'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

export class ShearTool implements Tool {
  readonly id = 'shear'
  readonly name = 'Shear'
  readonly shortcut = null
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
    this.controller.beginMode('shear', e, ctx)
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
