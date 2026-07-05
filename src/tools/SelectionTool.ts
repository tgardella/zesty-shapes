/**
 * Selection tool (V): click select / Shift-click add-remove / marquee select /
 * drag to move. Moving updates ONLY transform e,f (POSITIONING RULE), with
 * the doc-space delta mapped into each node's PARENT space through
 * worldTransform — never ancestor-agnostic math. One drag = one undo step.
 */

import type { Mat } from '../geometry/matrix'
import { applyToVector, invert } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { sub } from '../geometry/vec2'
import type { NodeId } from '../model/types'
import { DragBehavior } from './behaviors/DragBehavior'
import { MarqueeBehavior } from './behaviors/MarqueeBehavior'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

export class SelectionTool implements Tool {
  readonly id = 'selection'
  readonly name = 'Selection'
  readonly shortcut = 'v'
  readonly cursor = 'default'
  readonly wantsAngleSnap = true

  private readonly marquee = new MarqueeBehavior()
  private downDoc: Vec2 = { x: 0, y: 0 }
  private pressedId: NodeId | null = null
  /** Shift-clicked an already-selected node: deselect on up unless a drag happened. */
  private deselectOnUp: NodeId | null = null
  /** Plain-clicked one node of a multi-selection: collapse to it on up unless dragged. */
  private collapseOnUp = false
  private baseTransforms: Array<{ id: NodeId; base: Mat }> = []

  private readonly drag = new DragBehavior({
    transactionLabel: 'Move',
    onStart: (_e, ctx) => {
      const doc = ctx.getDocument()
      this.baseTransforms = ctx
        .getSelection()
        .filter((id) => doc.nodes[id] && !doc.nodes[id]!.locked)
        .map((id) => ({ id, base: [...doc.nodes[id]!.transform] as Mat }))
    },
    onMove: (e, ctx) => {
      const docDelta = sub(e.snappedPoint, this.downDoc)
      const doc = ctx.getDocument()
      const entries = this.baseTransforms.map(({ id, base }) => {
        const parentId = doc.nodes[id]?.parent
        // Doc-space delta -> parent-space delta through the parent's world transform.
        const d =
          parentId && parentId !== doc.root
            ? applyToVector(invert(ctx.worldTransform(parentId)), docDelta)
            : docDelta
        return {
          id,
          transform: [base[0], base[1], base[2], base[3], base[4] + d.x, base[5] + d.y] as Mat,
        }
      })
      ctx.commands.setTransforms(entries, 'Move')
    },
    onEnd: () => {
      // Commit happens in DragBehavior; a completed move never collapses/deselects.
      this.deselectOnUp = null
      this.collapseOnUp = false
      this.baseTransforms = []
    },
    onClick: (_e, ctx) => {
      if (this.deselectOnUp) {
        ctx.select.remove([this.deselectOnUp])
      } else if (this.collapseOnUp && this.pressedId) {
        ctx.select.set([this.pressedId])
      }
      this.deselectOnUp = null
      this.collapseOnUp = false
    },
  })

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    this.downDoc = e.docPoint
    this.deselectOnUp = null
    this.collapseOnUp = false
    this.pressedId = e.hitNodeId

    if (e.hitNodeId) {
      const selection = ctx.getSelection()
      const alreadySelected = selection.includes(e.hitNodeId)
      if (e.modifiers.shift) {
        if (alreadySelected) this.deselectOnUp = e.hitNodeId
        else ctx.select.add([e.hitNodeId])
      } else if (!alreadySelected) {
        ctx.select.set([e.hitNodeId])
      } else if (selection.length > 1) {
        this.collapseOnUp = true
      }
      this.drag.down(e)
    } else {
      this.marquee.begin(e)
    }
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.marquee.isActive) {
      this.marquee.update(e, ctx)
      return
    }
    this.drag.move(e, ctx)
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.marquee.isActive) {
      const rect = this.marquee.end(e, ctx)
      if (rect) {
        const ids = ctx.hitTest.nodesInRect(rect)
        if (e.modifiers.shift) ctx.select.add(ids)
        else ctx.select.set(ids)
      } else if (!e.modifiers.shift) {
        ctx.select.clear()
      }
      return
    }
    this.drag.up(e, ctx)
  }

  onCancel(ctx: ToolContext): void {
    this.drag.cancel(ctx) // rolls back the move transaction
    this.marquee.cancel(ctx)
    this.deselectOnUp = null
    this.collapseOnUp = false
    this.baseTransforms = []
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}
