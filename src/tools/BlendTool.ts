/**
 * Blend tool (W): click one object, then a second — the two blend into a
 * "Blend" group with N interpolated steps between them (the Steps selector
 * in the top bar; store/blendCommands does the assembly). Esc clears the
 * pending first pick.
 *
 * SPINE EDITING: when a live blend is selected, its spine (the path the steps
 * follow) shows in the overlay. Drag a control point to move it, drag the
 * round add-handle to bend the spine (inserts a control), or Alt-click an
 * interior control to remove it. One drag = one undo step.
 */

import { applyToPoint, invert } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import type { NodeId } from '../model/types'
import {
  blendSpineLayout,
  hitSpineInsert,
  hitSpinePoint,
  type BlendSpineLayout,
} from './blendSpineShared'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

const DRAG_THRESHOLD_PX = 3

export class BlendTool implements Tool {
  readonly id = 'blend'
  readonly name = 'Blend'
  readonly shortcut = 'w'
  readonly cursor = 'crosshair'

  private firstId: NodeId | null = null
  /** Hit captured on pointerDOWN: pointer capture retargets the up event. */
  private downHitId: NodeId | null = null
  /** Active spine-control drag (null while not editing a spine). */
  private spineDrag: { groupId: NodeId; controls: Vec2[]; index: number; moved: boolean } | null =
    null

  private toLocal(ctx: ToolContext, groupId: NodeId, docPoint: Vec2): Vec2 {
    return applyToPoint(invert(ctx.worldTransform(groupId)), docPoint)
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    this.downHitId = e.hitNodeId
    this.spineDrag = null

    // Spine editing takes priority over picking when a live blend is selected.
    const layout = blendSpineLayout(ctx.getDocument().nodes, ctx.getSelection(), ctx.getViewport())
    if (layout && this.beginSpineGesture(e, ctx, layout)) {
      this.downHitId = null
    }
  }

  /** Returns true when the pointer started a spine edit (drag/insert/remove). */
  private beginSpineGesture(
    e: ToolPointerEvent,
    ctx: ToolContext,
    layout: BlendSpineLayout,
  ): boolean {
    const controls = layout.controlsLocal
    const hit = hitSpinePoint(layout, e.screenPoint)
    if (hit >= 0) {
      // Alt-click removes an interior control (never the two endpoints).
      if (e.modifiers.alt && hit > 0 && hit < controls.length - 1 && controls.length > 2) {
        const next = controls.filter((_, i) => i !== hit)
        ctx.commands.setBlendSpine([layout.groupId], next)
        return true
      }
      this.spineDrag = { groupId: layout.groupId, controls: controls.map((p) => ({ ...p })), index: hit, moved: false }
      return true
    }
    if (hitSpineInsert(layout, e.screenPoint)) {
      const next = controls.map((p) => ({ ...p }))
      next.splice(layout.insert.afterIndex + 1, 0, { ...layout.insert.local })
      this.spineDrag = {
        groupId: layout.groupId,
        controls: next,
        index: layout.insert.afterIndex + 1,
        moved: false,
      }
      return true
    }
    return false
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.spineDrag) return
    const d = e.screenDeltaFromDown
    if (!this.spineDrag.moved && Math.hypot(d.x, d.y) < DRAG_THRESHOLD_PX) return
    if (!this.spineDrag.moved) {
      this.spineDrag.moved = true
      ctx.transaction.begin('Edit Blend Spine')
    }
    this.spineDrag.controls[this.spineDrag.index] = this.toLocal(ctx, this.spineDrag.groupId, e.docPoint)
    ctx.commands.setBlendSpine([this.spineDrag.groupId], this.spineDrag.controls)
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.spineDrag) {
      const drag = this.spineDrag
      this.spineDrag = null
      if (drag.moved && ctx.transaction.active()) {
        ctx.transaction.commit()
      } else if (drag.index !== -1 && !drag.moved) {
        // An insert click that never dragged still materializes the new control.
        ctx.commands.setBlendSpine([drag.groupId], drag.controls)
      }
      return
    }

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

  onCancel(ctx: ToolContext): void {
    if (this.spineDrag?.moved && ctx.transaction.active()) ctx.transaction.cancel()
    this.firstId = null
    this.downHitId = null
    this.spineDrag = null
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}
