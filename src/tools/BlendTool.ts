/**
 * Blend tool (W): click one object, then a second — the two blend into a
 * "Blend" group with N interpolated steps between them (the Steps selector
 * in the top bar; store/blendCommands does the assembly). Esc clears the
 * pending first pick.
 */

import type { NodeId } from '../model/types'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

export class BlendTool implements Tool {
  readonly id = 'blend'
  readonly name = 'Blend'
  readonly shortcut = 'w'
  readonly cursor = 'crosshair'

  private firstId: NodeId | null = null
  /** Hit captured on pointerDOWN: pointer capture retargets the up event. */
  private downHitId: NodeId | null = null

  onPointerDown(e: ToolPointerEvent, _ctx: ToolContext): void {
    this.downHitId = e.hitNodeId
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    const hitId = this.downHitId
    this.downHitId = null
    // A drag isn't a pick — only treat near-stationary releases as clicks.
    const d = e.screenDeltaFromDown
    if (Math.hypot(d.x, d.y) > 4) return
    if (!hitId) return
    const node = ctx.getDocument().nodes[hitId]
    if (!node || (node.type === 'group' && node.isLayer)) return

    if (this.firstId === null || this.firstId === hitId || !ctx.getDocument().nodes[this.firstId]) {
      this.firstId = hitId
      ctx.select.set([hitId])
      return
    }

    const steps = Math.max(1, Math.round(ctx.toolSize.get('blend')))
    const groupId = ctx.commands.blend(this.firstId, hitId, steps)
    this.firstId = null
    if (groupId) ctx.select.set([groupId])
  }

  onCancel(_ctx: ToolContext): void {
    this.firstId = null
    this.downHitId = null
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}
