/**
 * Curvature tool (toolbar-selected): click to drop points that auto-smooth
 * into a continuous curve (Catmull-Rom handles through every non-corner
 * point). Drag any point to reshape — the curve re-smooths live. Double-click
 * a point toggles corner <-> smooth. Click the first point to close.
 * Esc/Enter finishes; parametric shapes auto-convert on first touch.
 */

import { applyToPoint, translate } from '../geometry/matrix'
import type { AnchorId, NodeId } from '../model/types'
import { autoSmoothSubPath, createAnchor, createSubPath } from '../model/pathOps'
import { createPathNode, defaultStyle } from '../model/nodes'
import { worldTransform } from '../store/worldTransform'
import { DragBehavior } from './behaviors/DragBehavior'
import { leafNodeIdFromTarget } from './hitTest'
import { anchorAtScreenPoint, docPointToLocal, pathNodeOf } from './pathEditShared'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

export class CurvatureTool implements Tool {
  readonly id = 'curvature'
  readonly name = 'Curvature'
  readonly shortcut = null // toolbar-selected per the shortcut map
  readonly cursor = 'crosshair'

  private targetId: NodeId | null = null
  private dragAnchorId: AnchorId | null = null

  private readonly pointDrag = new DragBehavior(
    {
      transactionLabel: 'Move Point',
      onMove: (e, ctx) => {
        const id = this.targetId
        const anchorId = this.dragAnchorId
        if (!id || !anchorId) return
        const local = docPointToLocal(ctx.getDocument().nodes, id, e.snappedPoint)
        ctx.commands.updateNode(id, 'Move Point', (node) => {
          if (node.type !== 'path') return
          for (const sp of node.subpaths) {
            const anchor = sp.anchors.find((a) => a.id === anchorId)
            if (!anchor) continue
            anchor.point = { ...local }
            autoSmoothSubPath(sp)
            return
          }
        })
      },
      onEnd: () => {
        this.dragAnchorId = null
      },
      onClick: () => {
        this.dragAnchorId = null
      },
    },
    0,
  )

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    let target = pathNodeOf(doc.nodes, this.targetId) ?? pathNodeOf(doc.nodes, ctx.pathEdit.get()?.nodeId)

    // Grab an existing point to reshape (works while drawing too).
    if (target) {
      const hit = anchorAtScreenPoint(doc.nodes, target, ctx.getViewport(), e.screenPoint)
      if (hit) {
        const sp = target.subpaths.find((s) => s.id === hit.subPathId)
        // Clicking the FIRST point of the open subpath being drawn closes it.
        if (
          this.targetId === target.id &&
          sp &&
          !sp.closed &&
          sp.anchors.length > 2 &&
          hit.index === 0
        ) {
          ctx.commands.updateNode(target.id, 'Close Path', (node) => {
            if (node.type !== 'path') return
            const s = node.subpaths.find((x) => x.id === hit.subPathId)
            if (!s) return
            s.closed = true
            autoSmoothSubPath(s)
          })
          this.targetId = null
          return
        }
        this.targetId = target.id
        this.dragAnchorId = hit.anchorId
        ctx.pathEdit.set({ nodeId: target.id, anchorIds: [hit.anchorId] })
        this.pointDrag.down(e)
        return
      }
    }

    // Not on a point: extend the curve being drawn.
    if (this.targetId && target && target.id === this.targetId) {
      const local = docPointToLocal(doc.nodes, target.id, e.snappedPoint)
      const anchor = createAnchor(local, { type: 'smooth' })
      ctx.commands.updateNode(target.id, 'Add Point', (node) => {
        if (node.type !== 'path') return
        const sp = node.subpaths[node.subpaths.length - 1]
        if (!sp || sp.closed) return
        sp.anchors.push(anchor)
        autoSmoothSubPath(sp)
      })
      ctx.pathEdit.set({ nodeId: target.id, anchorIds: [anchor.id] })
      return
    }

    // Pick up an existing path (or convert a shape) to edit its points.
    const leafId = leafNodeIdFromTarget(doc, e.domTarget)
    if (leafId) {
      const leaf = doc.nodes[leafId]!
      let pathId: NodeId | null = null
      if (leaf.type === 'path') pathId = leafId
      else if (leaf.type !== 'group' && leaf.type !== 'text') {
        pathId = ctx.commands.convertToPath([leafId])[0] ?? null
      }
      if (pathId) {
        ctx.select.set([pathId])
        ctx.pathEdit.set({ nodeId: pathId, anchorIds: [] })
        // NOT this.targetId — clicking canvas afterwards starts a new curve
        // only when the user clicks empty space with nothing targeted; the
        // next empty click below starts drawing fresh.
      }
      return
    }

    // Empty canvas: start a new curve.
    const style = defaultStyle()
    style.fill = null
    const anchor = createAnchor({ x: 0, y: 0 }, { type: 'smooth' })
    const node = createPathNode([createSubPath([anchor], false)], {
      transform: translate(e.snappedPoint.x, e.snappedPoint.y),
      style,
    })
    ctx.commands.addNode(node, { select: true })
    ctx.pathEdit.set({ nodeId: node.id, anchorIds: [anchor.id] })
    this.targetId = node.id
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.dragAnchorId || this.pointDrag.isArmed) {
      this.pointDrag.move(e, ctx)
      return
    }
    // Rubber band toward the cursor while drawing.
    const doc = ctx.getDocument()
    const target = pathNodeOf(doc.nodes, this.targetId)
    const sp = target?.subpaths[target.subpaths.length - 1]
    const last = sp && !sp.closed ? sp.anchors[sp.anchors.length - 1] : null
    if (target && last) {
      const world = worldTransform(doc.nodes, target.id)
      ctx.overlay.setPenPreview({
        from: applyToPoint(world, last.point),
        fromHandle: last.handleOut ? applyToPoint(world, last.handleOut) : null,
        to: e.snappedPoint,
      })
    } else {
      ctx.overlay.setPenPreview(null)
    }
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    this.pointDrag.up(e, ctx)
  }

  /** Double-click a point: toggle corner <-> smooth, re-smoothing the curve. */
  onDoubleClick(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    const target =
      pathNodeOf(doc.nodes, this.targetId) ?? pathNodeOf(doc.nodes, ctx.pathEdit.get()?.nodeId)
    if (!target) return
    const hit = anchorAtScreenPoint(doc.nodes, target, ctx.getViewport(), e.screenPoint)
    if (!hit) return
    ctx.commands.updateNode(target.id, 'Convert Anchor', (node) => {
      if (node.type !== 'path') return
      const sp = node.subpaths.find((s) => s.id === hit.subPathId)
      const anchor = sp?.anchors.find((a) => a.id === hit.anchorId)
      if (!sp || !anchor) return
      if (anchor.type === 'corner') {
        anchor.type = 'smooth'
      } else {
        anchor.type = 'corner'
        anchor.handleIn = null
        anchor.handleOut = null
      }
      autoSmoothSubPath(sp)
    })
  }

  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean | void {
    if (e.key === 'Enter' && this.targetId) {
      this.finish(ctx)
      return true
    }
    return
  }

  onCancel(ctx: ToolContext): void {
    this.pointDrag.cancel(ctx)
    this.finish(ctx)
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
    ctx.pathEdit.set(null)
  }

  private finish(ctx: ToolContext): void {
    this.targetId = null
    this.dragAnchorId = null
    ctx.overlay.setPenPreview(null)
  }
}
