/**
 * Shared base for all shape-creation tools (Rectangle, Rounded Rectangle,
 * Ellipse, Polygon, Star, Line). One DragBehavior-backed gesture: the draft
 * node is created inside a transaction at the drag threshold, params update
 * live on move (POSITIONING RULE: params are LOCAL geometry, placement lives
 * in the transform), Esc cancels the whole draft away, degenerate drags
 * commit nothing, and the finished node is selected before commit — one
 * gesture, ONE undo step. Subclasses supply only the node factory and the
 * drag -> params mapping.
 */

import type { Vec2 } from '../../geometry/vec2'
import { angle, distance, length, sub } from '../../geometry/vec2'
import type { NodeId, SceneNode } from '../../model/types'
import { DragBehavior } from './DragBehavior'
import type { Tool, ToolContext, ToolModifiers, ToolPointerEvent } from '../types'

const MIN_SIZE = 0.01

// ---------------------------------------------------------------------------
// Pure drag -> geometry helpers (unit-testable, shared across tools)
// ---------------------------------------------------------------------------

export interface DragRect {
  x: number
  y: number
  w: number
  h: number
}

/** Corner-to-corner box: Shift = square, Alt = draw from the origin outward. */
export function dragRectGeometry(origin: Vec2, point: Vec2, modifiers: ToolModifiers): DragRect {
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

export interface RadialDrag {
  radius: number
  /** Orientation for polygonToPath/starToPath: first vertex toward the cursor. */
  angle: number
}

/** Center-out drag (polygon/star): Shift = upright orientation. */
export function radialDragParams(origin: Vec2, point: Vec2, modifiers: ToolModifiers): RadialDrag {
  const d = sub(point, origin)
  const radius = length(d)
  // shapes.ts places vertex 0 at (angle - PI/2); +PI/2 points it at the cursor.
  return { radius, angle: modifiers.shift || radius === 0 ? 0 : angle(d) + Math.PI / 2 }
}

export interface LineDrag {
  /** Local end point (start is the local origin). */
  end: Vec2
  /** Node placement (transform e,f). */
  position: Vec2
}

/** Start-to-end drag: Alt = extend symmetrically from the origin. */
export function lineDragParams(origin: Vec2, point: Vec2, modifiers: ToolModifiers): LineDrag {
  const d = sub(point, origin)
  if (modifiers.alt) {
    return { end: { x: 2 * d.x, y: 2 * d.y }, position: { x: origin.x - d.x, y: origin.y - d.y } }
  }
  return { end: d, position: origin }
}

// ---------------------------------------------------------------------------
// The base tool
// ---------------------------------------------------------------------------

export abstract class ShapeTool implements Tool {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly shortcut: string | null
  readonly cursor: string = 'crosshair'
  readonly wantsAngleSnap: boolean = false

  protected origin: Vec2 = { x: 0, y: 0 }
  private draftNodeId: NodeId | null = null
  private lastEvent: ToolPointerEvent | null = null
  private readonly drag: DragBehavior

  constructor(thresholdPx = 2) {
    this.drag = new DragBehavior(
      {
        // Evaluated lazily at gesture time — subclass fields are initialized by then.
        transactionLabel: () => `Draw ${this.name}`,
        onStart: (e, ctx) => {
          const node = this.createNode(this.origin)
          this.draftNodeId = node.id
          ctx.commands.addNode(node)
          this.update(e, ctx)
        },
        onMove: (e, ctx) => this.update(e, ctx),
        onEnd: (e, ctx) => {
          if (this.isDegenerate(this.origin, e.snappedPoint, e.modifiers)) {
            ctx.transaction.cancel() // draft evaporates, no undo entry
          } else if (this.draftNodeId) {
            ctx.select.set([this.draftNodeId]) // before commit -> restored on redo
          }
          this.reset()
        },
        onClick: () => this.reset(),
      },
      thresholdPx,
    )
  }

  /** Initial (zero-size) node placed at the gesture origin. */
  protected abstract createNode(origin: Vec2): SceneNode

  /** Map the live drag onto the draft node's LOCAL params + transform. */
  protected abstract applyDrag(
    node: SceneNode,
    origin: Vec2,
    point: Vec2,
    modifiers: ToolModifiers,
  ): void

  /** Drags below this produce nothing (transaction cancelled). */
  protected isDegenerate(origin: Vec2, point: Vec2, _modifiers: ToolModifiers): boolean {
    return distance(origin, point) < MIN_SIZE
  }

  protected get isDrawing(): boolean {
    return this.drag.isDragging && this.draftNodeId !== null
  }

  /** Re-run applyDrag or a focused mutation mid-gesture (arrow-key params). */
  protected updateDraft(ctx: ToolContext, mutate: (node: SceneNode) => void): void {
    if (!this.isDrawing || !this.draftNodeId) return
    ctx.commands.updateNode(this.draftNodeId, `Draw ${this.name}`, mutate)
  }

  private update(e: ToolPointerEvent, ctx: ToolContext): void {
    this.lastEvent = e
    if (!this.draftNodeId) return
    ctx.commands.updateNode(this.draftNodeId, `Draw ${this.name}`, (node) =>
      this.applyDrag(node, this.origin, e.snappedPoint, e.modifiers),
    )
  }

  private reset(): void {
    this.draftNodeId = null
    this.lastEvent = null
  }

  /** Latest pointer event of the active gesture (for key-driven re-apply). */
  protected get currentDragEvent(): ToolPointerEvent | null {
    return this.lastEvent
  }

  onPointerDown(e: ToolPointerEvent, _ctx: ToolContext): void {
    this.origin = e.snappedPoint
    this.drag.down(e)
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    this.drag.move(e, ctx)
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    this.drag.up(e, ctx)
  }

  onCancel(ctx: ToolContext): void {
    this.drag.cancel(ctx) // rolls the draft out of the document
    this.reset()
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}
