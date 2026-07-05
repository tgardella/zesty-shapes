/**
 * Rectangle tool (M): click-drag to create a RectNode. Shift = square,
 * Alt = draw from center (both live-updatable mid-drag). Per the POSITIONING
 * RULE the rect params stay at local origin (x=y=0) and the node transform
 * carries placement. The whole gesture is ONE undo step; Esc cancels.
 */

import { translate } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import type { NodeId } from '../model/types'
import { createRectNode } from '../model/nodes'
import { DragBehavior } from './behaviors/DragBehavior'
import type { Tool, ToolContext, ToolModifiers, ToolPointerEvent } from './types'

const MIN_SIZE = 0.01

interface RectGeometry {
  x: number
  y: number
  w: number
  h: number
}

function rectGeometry(origin: Vec2, point: Vec2, modifiers: ToolModifiers): RectGeometry {
  let dx = point.x - origin.x
  let dy = point.y - origin.y
  if (modifiers.shift) {
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    dx = (dx < 0 ? -1 : 1) * size
    dy = (dy < 0 ? -1 : 1) * size
  }
  if (modifiers.alt) {
    return {
      x: origin.x - Math.abs(dx),
      y: origin.y - Math.abs(dy),
      w: Math.abs(dx) * 2,
      h: Math.abs(dy) * 2,
    }
  }
  return {
    x: Math.min(origin.x, origin.x + dx),
    y: Math.min(origin.y, origin.y + dy),
    w: Math.abs(dx),
    h: Math.abs(dy),
  }
}

export class RectangleTool implements Tool {
  readonly id = 'rectangle'
  readonly name = 'Rectangle'
  readonly shortcut = 'm'
  readonly cursor = 'crosshair'
  readonly wantsAngleSnap = false // Shift means "square" here, not 45°

  private downDoc: Vec2 = { x: 0, y: 0 }
  private draftId: NodeId | null = null

  private readonly drag = new DragBehavior(
    {
      transactionLabel: 'Draw Rectangle',
      onStart: (e, ctx) => {
        const node = createRectNode(
          { x: 0, y: 0, w: 0, h: 0 },
          { transform: translate(this.downDoc.x, this.downDoc.y) },
        )
        this.draftId = node.id
        ctx.commands.addNode(node)
        this.applyGeometry(e, ctx)
      },
      onMove: (e, ctx) => this.applyGeometry(e, ctx),
      onEnd: (e, ctx) => {
        const g = rectGeometry(this.downDoc, e.snappedPoint, e.modifiers)
        if (g.w < MIN_SIZE || g.h < MIN_SIZE) {
          ctx.transaction.cancel() // degenerate: nothing gets created
        } else if (this.draftId) {
          ctx.select.set([this.draftId]) // before commit -> restored on redo
        }
        this.draftId = null
      },
      onClick: () => {
        this.draftId = null
      },
    },
    2,
  )

  private applyGeometry(e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.draftId) return
    const g = rectGeometry(this.downDoc, e.snappedPoint, e.modifiers)
    ctx.commands.updateNode(this.draftId, 'Draw Rectangle', (node) => {
      if (node.type !== 'rect') return
      node.w = g.w
      node.h = g.h
      node.transform = translate(g.x, g.y)
    })
  }

  onPointerDown(e: ToolPointerEvent, _ctx: ToolContext): void {
    this.downDoc = e.snappedPoint
    this.drag.down(e)
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    this.drag.move(e, ctx)
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    this.drag.up(e, ctx)
  }

  onCancel(ctx: ToolContext): void {
    this.drag.cancel(ctx) // rolls the draft rect back out of the document
    this.draftId = null
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}
