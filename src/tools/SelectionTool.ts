/**
 * Selection tool (V):
 * - click select / Shift-click add-remove / marquee (Alt = contain mode,
 *   default = intersect)
 * - drag to move (transform e,f only, delta mapped into each node's parent
 *   space through worldTransform); Alt-drag duplicates and moves the copies
 * - double-click a group to ENTER it (isolation scope); double-click empty
 *   canvas to exit; clicking an out-of-scope node exits automatically
 * - arrow-key nudge (Shift = 10x)
 * - live corner-radius handle when a single RectNode is selected
 * Every drag gesture is ONE undo step.
 */

import type { Mat } from '../geometry/matrix'
import { invert, applyToPoint } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { distance, scale, sub } from '../geometry/vec2'
import { worldBBoxOfNode } from '../geometry/bbox'
import type { NodeId } from '../model/types'
import { docDeltaInParentSpace } from '../store/commands'
import { worldTransform } from '../store/worldTransform'
import { gridAlignedDelta } from '../snapping/snappers'
import { DragBehavior } from './behaviors/DragBehavior'
import { MarqueeBehavior } from './behaviors/MarqueeBehavior'
import { TransformHandleController } from './behaviors/TransformHandleBehavior'
import { HANDLE_GRAB_RADIUS_PX, rectRadiusHandle } from './handles'
import { leafNodeAtPoint, leafNodeIdFromTarget } from './hitTest'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

const NUDGE_STEP = 1
const NUDGE_STEP_LARGE = 10

const NUDGE_KEYS: Record<string, Vec2> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

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
  /** Primary object's world-bbox top-left at drag start (grid-snap anchor). */
  private snapRef: Vec2 | null = null
  /** Non-null while dragging the corner-radius widget. */
  private radiusNodeId: NodeId | null = null
  /** Scale/rotate gestures on the bbox handles + rotation knob. */
  private readonly transformHandles = new TransformHandleController()

  // -- move / duplicate drag --------------------------------------------------

  private readonly drag = new DragBehavior({
    transactionLabel: (e) => (e.modifiers.alt ? 'Duplicate' : 'Move'),
    onStart: (e, ctx) => {
      let ids = ctx.getSelection()
      if (e.modifiers.alt && ids.length > 0) {
        // Alt-drag: duplicate in place, then move the duplicates. Everything
        // lands in the open 'Duplicate' transaction — one undo step.
        ids = ctx.commands.duplicateNodes(ids)
      }
      const doc = ctx.getDocument()
      this.baseTransforms = ids
        .filter((id) => doc.nodes[id] && !doc.nodes[id]!.locked)
        .map((id) => ({ id, base: [...doc.nodes[id]!.transform] as Mat }))
      // Grid snap anchors on the PRIMARY object's world-space top-left, so
      // the moved object lands on the grid (not the cursor under the grab).
      const first = this.baseTransforms[0]
      const b = first ? worldBBoxOfNode(doc.nodes, first.id, worldTransform(doc.nodes, first.id)) : null
      this.snapRef = b ? { x: b.minX, y: b.minY } : null
    },
    onMove: (e, ctx) => {
      const grid = ctx.gridSnap()
      const docDelta =
        grid.enabled && grid.size > 0 && this.snapRef
          ? // Snap the OBJECT: land its top-left on the nearest grid line.
            gridAlignedDelta(this.snapRef, sub(e.docPoint, this.downDoc), grid.size)
          : sub(e.snappedPoint, this.downDoc)
      const doc = ctx.getDocument()
      const entries = this.baseTransforms.map(({ id, base }) => {
        const d = docDeltaInParentSpace(doc.nodes, doc.nodes[id]?.parent ?? null, doc.root, docDelta)
        return {
          id,
          transform: [base[0], base[1], base[2], base[3], base[4] + d.x, base[5] + d.y] as Mat,
        }
      })
      ctx.commands.setTransforms(entries, 'Move')
    },
    onEnd: () => {
      this.deselectOnUp = null
      this.collapseOnUp = false
      this.baseTransforms = []
      this.snapRef = null
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

  // -- corner-radius drag (threshold 0: engages on first move) ----------------

  private readonly radiusDrag = new DragBehavior(
    {
      transactionLabel: 'Corner Radius',
      onMove: (e, ctx) => {
        const id = this.radiusNodeId
        if (!id) return
        const doc = ctx.getDocument()
        const node = doc.nodes[id]
        if (!node || node.type !== 'rect') return
        const local = applyToPoint(invert(worldTransform(doc.nodes, id)), e.docPoint)
        const maxRadius = Math.min(Math.abs(node.w), Math.abs(node.h)) / 2
        const r = Math.max(0, Math.min(maxRadius, local.x - node.x))
        ctx.commands.updateNode(id, 'Corner Radius', (n) => {
          if (n.type !== 'rect') return
          n.rx = r
          n.ry = r
        })
      },
      onEnd: () => {
        this.radiusNodeId = null
      },
      onClick: () => {
        this.radiusNodeId = null
      },
    },
    0,
  )

  // -- pointer pipeline --------------------------------------------------------

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    this.downDoc = e.docPoint
    this.deselectOnUp = null
    this.collapseOnUp = false
    this.pressedId = e.hitNodeId

    // The corner-radius widget wins over everything at its screen position.
    const radiusHandle = rectRadiusHandle(
      ctx.getDocument().nodes,
      ctx.getSelection(),
      ctx.getViewport(),
    )
    if (radiusHandle && distance(e.screenPoint, radiusHandle.screenPoint) <= HANDLE_GRAB_RADIUS_PX) {
      this.radiusNodeId = radiusHandle.nodeId
      this.radiusDrag.down(e)
      return
    }

    // Bbox scale handles + rotation knob (established by the transform overlay).
    if (this.transformHandles.tryBegin(e, ctx, 'both')) return

    if (e.hitNodeId) {
      const doc = ctx.getDocument()
      // Clicking top-level art (a direct child of the root or a layer) while
      // isolated inside a group exits isolation. Layers are transparent, so
      // their children count as top-level.
      const parentId = doc.nodes[e.hitNodeId]?.parent
      const parentNode = parentId ? doc.nodes[parentId] : null
      const isTopLevelArt =
        parentId === doc.root || (parentNode?.type === 'group' && parentNode.isLayer === true)
      if (isTopLevelArt && ctx.scope.current() !== doc.root) {
        ctx.scope.set(null)
      }
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
    if (this.transformHandles.isActive) {
      this.transformHandles.move(e, ctx)
      return
    }
    if (this.radiusNodeId) {
      this.radiusDrag.move(e, ctx)
      return
    }
    if (this.marquee.isActive) {
      this.marquee.update(e, ctx)
      return
    }
    this.drag.move(e, ctx)
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.transformHandles.isActive) {
      this.transformHandles.up(e, ctx)
      return
    }
    if (this.radiusNodeId || this.radiusDrag.isArmed) {
      this.radiusDrag.up(e, ctx)
      return
    }
    if (this.marquee.isActive) {
      const rect = this.marquee.end(e, ctx)
      if (rect) {
        const ids = ctx.hitTest.nodesInRect(rect, e.modifiers.alt ? 'contain' : 'intersect')
        if (e.modifiers.shift) ctx.select.add(ids)
        else ctx.select.set(ids)
      } else if (!e.modifiers.shift) {
        ctx.select.clear()
      }
      return
    }
    this.drag.up(e, ctx)
  }

  /**
   * Double-click: edit a text node in place, enter the clicked group, or
   * exit isolation on empty canvas.
   */
  onDoubleClick(e: ToolPointerEvent, ctx: ToolContext): void {
    // Text wins at any nesting depth (Illustrator: double-click = edit).
    const leafId =
      leafNodeIdFromTarget(ctx.getDocument(), e.domTarget) ??
      leafNodeAtPoint(
        ctx.getDocument(),
        e.docPoint,
        HANDLE_GRAB_RADIUS_PX / ctx.getViewport().zoom,
      )
    if (leafId && ctx.getDocument().nodes[leafId]?.type === 'text') {
      ctx.commands.editTextNode(leafId)
      return
    }
    if (e.hitNodeId) {
      const node = ctx.getDocument().nodes[e.hitNodeId]
      if (node?.type === 'group') {
        ctx.scope.set(node.id)
        // Re-resolve the click inside the new scope and select what was hit.
        const inner = ctx.hitTest.topNodeAt(e.domTarget)
        ctx.select.set(inner ? [inner] : [])
      }
    } else {
      ctx.scope.set(null)
    }
  }

  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean | void {
    const dir = NUDGE_KEYS[e.key]
    if (dir) {
      const selection = ctx.getSelection()
      if (selection.length === 0) return
      const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP
      ctx.commands.moveNodesBy(selection, scale(dir, step), 'Nudge')
      return true
    }
    return
  }

  onCancel(ctx: ToolContext): void {
    this.drag.cancel(ctx) // rolls back the move/duplicate transaction
    this.transformHandles.cancel(ctx)
    this.radiusDrag.cancel(ctx)
    this.marquee.cancel(ctx)
    this.radiusNodeId = null
    this.deselectOnUp = null
    this.collapseOnUp = false
    this.baseTransforms = []
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}
