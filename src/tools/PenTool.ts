/**
 * Pen tool (P):
 * - click = corner anchor; click-drag = symmetric handles (Alt while
 *   dragging = break: only the outgoing handle moves)
 * - click the first anchor = close the path (drag shapes its handles)
 * - click an open path's endpoint = continue that path (from either end)
 * - click a non-endpoint anchor of the target = DELETE that anchor
 * - click a segment of the target = ADD an anchor there (exact split)
 * - Enter / Esc = finish; parametric shapes auto-convert on first touch
 * Each click/drag is its own transaction (one undo step per anchor).
 * A rubber-band preview shows the exact would-be segment while drawing.
 */

import { distance } from '../geometry/vec2'
import { applyToPoint, translate } from '../geometry/matrix'
import type { AnchorId, NodeId, PathNode, SubPath } from '../model/types'
import {
  createAnchor,
  createSubPath,
  insertAnchorOnSegment,
  mirrorHandle,
  removeAnchor,
  reverseSubPath,
} from '../model/pathOps'
import { cloneStyle, createPathNode } from '../model/nodes'
import { worldTransform } from '../store/worldTransform'
import { leafNodeIdFromTarget } from './hitTest'
import {
  anchorAtScreenPoint,
  docPointToLocal,
  openEndpointKind,
  pathNodeOf,
  segmentAtScreenPoint,
} from './pathEditShared'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

const CLOSE_HIT_PX = 6

type Gesture =
  | { kind: 'new-anchor'; anchorId: AnchorId }
  | { kind: 'close'; anchorId: AnchorId }
  | null

export class PenTool implements Tool {
  readonly id = 'pen'
  readonly name = 'Pen'
  readonly shortcut = 'p'
  readonly cursor = 'crosshair'

  /** Path currently being drawn (append at the END of its last subpath). */
  private targetId: NodeId | null = null
  private gesture: Gesture = null

  // -- pointer pipeline -------------------------------------------------------

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    const drawing = pathNodeOf(doc.nodes, this.targetId)

    if (drawing) {
      const sp = lastSubPath(drawing)
      const first = sp && !sp.closed && sp.anchors.length > 1 ? sp.anchors[0]! : null
      if (first) {
        const firstScreen = ctx.docToScreen(
          applyToPoint(worldTransform(doc.nodes, drawing.id), first.point),
        )
        if (distance(firstScreen, e.screenPoint) <= CLOSE_HIT_PX) {
          // Close the path.
          ctx.transaction.begin('Close Path')
          ctx.commands.updateNode(drawing.id, 'Close Path', (node) => {
            if (node.type !== 'path') return
            const s = node.subpaths[node.subpaths.length - 1]
            if (s) s.closed = true
          })
          this.gesture = { kind: 'close', anchorId: first.id }
          return
        }
      }
      // Append an anchor at the (snapped) point.
      const local = docPointToLocal(doc.nodes, drawing.id, e.snappedPoint)
      const anchor = createAnchor(local)
      ctx.transaction.begin('Add Anchor')
      ctx.commands.updateNode(drawing.id, 'Add Anchor', (node) => {
        if (node.type !== 'path') return
        node.subpaths[node.subpaths.length - 1]?.anchors.push(anchor)
      })
      ctx.pathEdit.set({ nodeId: drawing.id, anchorIds: [anchor.id] })
      this.gesture = { kind: 'new-anchor', anchorId: anchor.id }
      return
    }

    // Not drawing: interact with an existing path, or start a new one.
    const pe = ctx.pathEdit.get()
    let target = pathNodeOf(doc.nodes, pe?.nodeId)
    if (!target) {
      const leafId = leafNodeIdFromTarget(doc, e.domTarget)
      if (leafId) {
        const leaf = doc.nodes[leafId]!
        if (leaf.type === 'path') target = leaf as PathNode
        else if (leaf.type !== 'group' && leaf.type !== 'text') {
          const converted = ctx.commands.convertToPath([leafId])
          target = pathNodeOf(ctx.getDocument().nodes, converted[0] ?? null)
        }
        if (target) {
          ctx.select.set([target.id])
          ctx.pathEdit.set({ nodeId: target.id, anchorIds: [] })
        }
      }
    }

    if (target) {
      const anchorHit = anchorAtScreenPoint(doc.nodes, target, ctx.getViewport(), e.screenPoint)
      if (anchorHit) {
        const endpoint = openEndpointKind(target, anchorHit.anchorId)
        if (endpoint) {
          // Continue this open path; append at the END, so reverse if needed.
          if (endpoint === 'start') {
            ctx.commands.updateNode(target.id, 'Continue Path', (node) => {
              if (node.type !== 'path') return
              const sp = node.subpaths.find((s) => s.id === anchorHit.subPathId)
              if (sp) reverseSubPath(sp)
            })
          }
          moveSubPathLast(ctx, target.id, anchorHit.subPathId)
          this.targetId = target.id
          ctx.select.set([target.id])
          ctx.pathEdit.set({ nodeId: target.id, anchorIds: [] })
          return
        }
        // Non-endpoint anchor: delete it (pen minus).
        ctx.commands.updateNode(target.id, 'Delete Anchor', (node) => {
          if (node.type !== 'path') return
          for (const sp of node.subpaths) {
            if (removeAnchor(sp, anchorHit.anchorId)) break
          }
          node.subpaths = node.subpaths.filter((sp) => sp.anchors.length >= 2)
        })
        if (ctx.getDocument().nodes[target.id] && (ctx.getDocument().nodes[target.id] as PathNode).subpaths.length === 0) {
          ctx.commands.deleteNodes([target.id])
          ctx.pathEdit.set(null)
        }
        return
      }
      const segHit = segmentAtScreenPoint(doc.nodes, target, ctx.getViewport(), e.screenPoint)
      if (segHit) {
        // Add an anchor on the segment (exact de Casteljau split).
        let newAnchorId: AnchorId | null = null
        ctx.commands.updateNode(target.id, 'Add Anchor', (node) => {
          if (node.type !== 'path') return
          const sp = node.subpaths.find((s) => s.id === segHit.subPathId)
          if (sp) newAnchorId = insertAnchorOnSegment(sp, segHit.segIndex, segHit.t).id
        })
        if (newAnchorId) ctx.pathEdit.set({ nodeId: target.id, anchorIds: [newAnchorId] })
        return
      }
    }

    // Start a NEW path at the snapped point (anchors local, placement in transform).
    const style = cloneStyle(ctx.style.current())
    style.fill = null // open stroked path
    const anchor = createAnchor({ x: 0, y: 0 })
    const node = createPathNode([createSubPath([anchor], false)], {
      transform: translate(e.snappedPoint.x, e.snappedPoint.y),
      style,
    })
    ctx.transaction.begin('New Path')
    ctx.commands.addNode(node, { select: true })
    ctx.pathEdit.set({ nodeId: node.id, anchorIds: [anchor.id] })
    this.targetId = node.id
    this.gesture = { kind: 'new-anchor', anchorId: anchor.id }
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.gesture) {
      this.dragHandles(e, ctx)
      return
    }
    this.updatePreview(e, ctx)
  }

  onPointerUp(_e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.gesture) return
    const closing = this.gesture.kind === 'close'
    this.gesture = null
    ctx.transaction.commit()
    if (closing) {
      this.targetId = null
      ctx.overlay.setPenPreview(null)
    }
  }

  /** Shape the handles of the anchor being placed (symmetric; Alt = break). */
  private dragHandles(e: ToolPointerEvent, ctx: ToolContext): void {
    const g = this.gesture
    const id = this.targetId
    if (!g || !id) return
    const local = docPointToLocal(ctx.getDocument().nodes, id, e.snappedPoint)
    ctx.commands.updateNode(id, 'Shape Anchor', (node) => {
      if (node.type !== 'path') return
      for (const sp of node.subpaths) {
        const anchor = sp.anchors.find((a) => a.id === g.anchorId)
        if (!anchor) continue
        if (g.kind === 'close') {
          // Closing drag shapes the first anchor's INCOMING side.
          anchor.handleIn = { ...local }
          if (!e.modifiers.alt) {
            anchor.handleOut = mirrorHandle(anchor.point, local)
            anchor.type = 'symmetric'
          } else {
            anchor.type = 'corner'
          }
        } else {
          anchor.handleOut = { ...local }
          if (e.modifiers.alt) {
            anchor.type = 'corner' // broken: incoming side untouched
          } else {
            anchor.handleIn = mirrorHandle(anchor.point, local)
            anchor.type = 'symmetric'
          }
        }
        return
      }
    })
  }

  /** Rubber band: the EXACT would-be segment from the last anchor to the cursor. */
  private updatePreview(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    const drawing = pathNodeOf(doc.nodes, this.targetId)
    const sp = drawing ? lastSubPath(drawing) : null
    const last = sp && sp.anchors.length > 0 ? sp.anchors[sp.anchors.length - 1]! : null
    if (!drawing || !last) {
      ctx.overlay.setPenPreview(null)
      return
    }
    const world = worldTransform(doc.nodes, drawing.id)
    ctx.overlay.setPenPreview({
      from: applyToPoint(world, last.point),
      fromHandle: last.handleOut ? applyToPoint(world, last.handleOut) : null,
      to: e.snappedPoint,
    })
  }

  onKeyDown(e: KeyboardEvent, _ctx: ToolContext): boolean | void {
    if (e.key === 'Enter' && this.targetId) {
      this.finish(_ctx)
      return true
    }
    return
  }

  onCancel(ctx: ToolContext): void {
    // Esc: the open per-anchor transaction is rolled back by the manager.
    this.gesture = null
    this.finish(ctx)
  }

  onDeactivate(ctx: ToolContext): void {
    this.finish(ctx)
    ctx.pathEdit.set(null)
  }

  private finish(ctx: ToolContext): void {
    this.targetId = null
    this.gesture = null
    ctx.overlay.setPenPreview(null)
  }
}

function lastSubPath(node: PathNode): SubPath | null {
  return node.subpaths[node.subpaths.length - 1] ?? null
}

/** Ensure the subpath being continued is the LAST one (pen appends there). */
function moveSubPathLast(ctx: ToolContext, nodeId: NodeId, subPathId: string): void {
  const node = ctx.getDocument().nodes[nodeId]
  if (!node || node.type !== 'path') return
  if (node.subpaths[node.subpaths.length - 1]?.id === subPathId) return
  ctx.commands.updateNode(nodeId, 'Continue Path', (n) => {
    if (n.type !== 'path') return
    const i = n.subpaths.findIndex((s) => s.id === subPathId)
    if (i === -1) return
    const [sp] = n.subpaths.splice(i, 1)
    if (sp) n.subpaths.push(sp)
  })
}
