/**
 * Gradient Mesh tool (U), the Illustrator flow:
 * - Click a shape/path: converts it to a 1x1 gradient mesh in place.
 * - Click inside a mesh: adds a row+column through the click, the new point
 *   colored with the current fill.
 * - Click a mesh grid point: selects it (Alt+click recolors it with the
 *   current fill). Dragging a point warps the mesh — one drag = one undo step.
 *
 * Point hit-testing shares meshEditShared with the overlay grid drawing.
 */

import { invert, applyToPoint } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import type { NodeId, RGBA } from '../model/types'
import type { MeshHandleDir } from '../model/mesh'
import { leafNodeIdFromTarget } from './hitTest'
import { hitMeshHandle, hitMeshPoint, meshHandleLayout, meshOverlayLayout } from './meshEditShared'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

const DRAG_THRESHOLD_PX = 3

/** The paint applied to new/Alt-clicked mesh points: the current solid fill. */
function meshColor(ctx: ToolContext): RGBA {
  const fill = ctx.style.current().fill
  if (fill && fill.type === 'solid') return { ...fill.color }
  return { r: 255, g: 255, b: 255, a: 1 }
}

export class GradientMeshTool implements Tool {
  readonly id = 'gradient-mesh'
  readonly name = 'Gradient Mesh'
  readonly shortcut = 'u'
  readonly cursor = 'crosshair'

  /** Point-drag gesture state (null while idle). */
  private drag: { nodeId: NodeId; pointIndex: number; moved: boolean } | null = null
  /** Tangent-handle drag gesture state (null while idle). */
  private handleDrag: { nodeId: NodeId; index: number; dir: MeshHandleDir; moved: boolean } | null =
    null

  private toLocal(ctx: ToolContext, nodeId: NodeId, docPoint: Vec2): Vec2 {
    return applyToPoint(invert(ctx.worldTransform(nodeId)), docPoint)
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()

    // The selected point's tangent handles grab first (they sit off the grid).
    const handles = meshHandleLayout(doc.nodes, ctx.meshEdit.get(), ctx.getViewport())
    if (handles) {
      const dir = hitMeshHandle(handles, e.screenPoint)
      if (dir) {
        this.handleDrag = { nodeId: handles.nodeId, index: handles.index, dir, moved: false }
        return
      }
    }

    // A selected mesh's grid points grab next (they can hang outside the fill).
    const layout = meshOverlayLayout(doc.nodes, ctx.getSelection(), ctx.getViewport())
    if (layout) {
      const index = hitMeshPoint(layout, e.screenPoint)
      if (index >= 0) {
        ctx.meshEdit.set({ nodeId: layout.nodeId, pointIndex: index })
        if (e.modifiers.alt) {
          ctx.mesh.setPointColor(layout.nodeId, index, meshColor(ctx))
          return
        }
        this.drag = { nodeId: layout.nodeId, pointIndex: index, moved: false }
        return
      }
    }

    // Prefer the actual LEAF under the pointer (meshes nest inside groups).
    const hitId = leafNodeIdFromTarget(doc, e.domTarget) ?? e.hitNodeId
    if (!hitId) {
      ctx.select.clear()
      ctx.meshEdit.set(null)
      return
    }
    const node = doc.nodes[hitId]
    if (!node) return

    if (node.type === 'mesh') {
      ctx.select.set([hitId])
      // Click inside the grid: add a row+column through it, colored with the
      // current fill (Illustrator's add-mesh-point).
      const index = ctx.mesh.addDivision(hitId, this.toLocal(ctx, hitId, e.docPoint), meshColor(ctx))
      ctx.meshEdit.set(index >= 0 ? { nodeId: hitId, pointIndex: index } : null)
      return
    }

    // First click on a plain shape/path: convert it to a mesh in place.
    if (ctx.commands.convertToMesh(hitId)) {
      ctx.select.set([hitId])
      ctx.meshEdit.set(null)
    }
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.handleDrag) {
      const d = e.screenDeltaFromDown
      if (!this.handleDrag.moved && Math.hypot(d.x, d.y) < DRAG_THRESHOLD_PX) return
      if (!this.handleDrag.moved) {
        this.handleDrag.moved = true
        ctx.transaction.begin('Adjust Mesh Handle')
      }
      // Alt breaks the point's symmetry (moves this handle independently).
      ctx.mesh.setHandle(
        this.handleDrag.nodeId,
        this.handleDrag.index,
        this.handleDrag.dir,
        this.toLocal(ctx, this.handleDrag.nodeId, e.docPoint),
        !e.modifiers.alt,
      )
      return
    }
    if (!this.drag) return
    const d = e.screenDeltaFromDown
    if (!this.drag.moved && Math.hypot(d.x, d.y) < DRAG_THRESHOLD_PX) return
    if (!this.drag.moved) {
      this.drag.moved = true
      ctx.transaction.begin('Move Mesh Point')
    }
    ctx.mesh.movePoint(
      this.drag.nodeId,
      this.drag.pointIndex,
      this.toLocal(ctx, this.drag.nodeId, e.docPoint),
    )
  }

  onPointerUp(_e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.handleDrag?.moved && ctx.transaction.active()) ctx.transaction.commit()
    if (this.drag?.moved && ctx.transaction.active()) ctx.transaction.commit()
    this.handleDrag = null
    this.drag = null
  }

  onCancel(_ctx: ToolContext): void {
    // The manager rolls back any open transaction (undoing the partial drag).
    this.drag = null
    this.handleDrag = null
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
    ctx.meshEdit.set(null)
  }
}
