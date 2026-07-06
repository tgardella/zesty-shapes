/**
 * Lasso (Q): freehand selection region (point-in-polygon).
 * - ANCHOR mode: when the lasso encloses anchors of any currently SELECTED
 *   path, it selects those anchors (sets the path-edit target) — the anchor-
 *   level companion to Direct Selection, like Illustrator's lasso.
 * - OBJECT mode otherwise: selects every visible unlocked leaf whose
 *   flattened world geometry lies ENTIRELY inside the region (Illustrator:
 *   only what the drawn boundary fully encloses is selected; text uses its
 *   bbox corners). Shift adds to the selection.
 */

import { applyToPoint } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import { pointInRegions, type Regions } from '../geometry/boolean'
import { localBBoxOfNode } from '../geometry/bbox'
import type { Document, GroupNode, NodeId, PathNode } from '../model/types'
import { flattenSubPath } from '../model/booleanOps'
import { toSubPaths } from '../model/nodes'
import { worldTransform } from '../store/worldTransform'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

const TRAIL_STEP = 2
const MIN_POINTS = 3

export class LassoTool implements Tool {
  readonly id = 'lasso'
  readonly name = 'Lasso'
  readonly shortcut = 'q'
  readonly cursor = 'crosshair'

  private trail: Vec2[] | null = null

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    this.trail = [e.docPoint]
    ctx.overlay.setLasso(this.trail)
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.trail) return
    if (distance(this.trail[this.trail.length - 1]!, e.docPoint) < TRAIL_STEP) return
    this.trail = [...this.trail, e.docPoint]
    ctx.overlay.setLasso(this.trail)
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    const trail = this.trail
    this.trail = null
    ctx.overlay.setLasso(null)
    if (!trail || trail.length < MIN_POINTS) return
    const region: Regions = [[trail]]
    const doc = ctx.getDocument()

    // ANCHOR mode: anchors of selected paths inside the region.
    const anchorHit = this.anchorsInRegion(doc, ctx.getSelection(), region)
    if (anchorHit) {
      const prev = ctx.pathEdit.get()
      const keep =
        e.modifiers.shift && prev?.nodeId === anchorHit.nodeId ? prev.anchorIds : []
      ctx.pathEdit.set({
        nodeId: anchorHit.nodeId,
        anchorIds: [...new Set([...keep, ...anchorHit.anchorIds])],
      })
      ctx.select.set([anchorHit.nodeId])
      return
    }

    // OBJECT mode.
    const hits = this.leavesInRegion(doc, region)
    if (e.modifiers.shift) ctx.select.add(hits)
    else ctx.select.set(hits)
  }

  /** First selected PathNode with anchors inside the region (world space). */
  private anchorsInRegion(
    doc: Document,
    selection: NodeId[],
    region: Regions,
  ): { nodeId: NodeId; anchorIds: string[] } | null {
    for (const id of selection) {
      const node = doc.nodes[id]
      if (!node || node.type !== 'path' || node.locked || node.hidden) continue
      const world = worldTransform(doc.nodes, id)
      const inside: string[] = []
      for (const sp of (node as PathNode).subpaths) {
        for (const anchor of sp.anchors) {
          if (pointInRegions(region, applyToPoint(world, anchor.point))) {
            inside.push(anchor.id)
          }
        }
      }
      if (inside.length > 0) return { nodeId: id, anchorIds: inside }
    }
    return null
  }

  /** Leaves whose flattened world geometry is fully contained in the region. */
  private leavesInRegion(doc: Document, region: Regions): NodeId[] {
    const out: NodeId[] = []
    const visit = (id: NodeId): void => {
      const node = doc.nodes[id]
      if (!node || node.locked || node.hidden) return
      if (node.type === 'group') {
        for (const child of node.children) visit(child)
        return
      }
      const world = worldTransform(doc.nodes, id)
      let points: Vec2[]
      if (node.type === 'text') {
        const local = localBBoxOfNode(node, doc.nodes)
        points = local
          ? [
              { x: local.minX, y: local.minY },
              { x: local.maxX, y: local.minY },
              { x: local.maxX, y: local.maxY },
              { x: local.minX, y: local.maxY },
            ]
          : []
      } else {
        points = toSubPaths(node).flatMap((sp) => flattenSubPath(sp))
      }
      if (
        points.length > 0 &&
        points.every((p) => pointInRegions(region, applyToPoint(world, p)))
      ) {
        out.push(id)
      }
    }
    for (const id of (doc.nodes[doc.root] as GroupNode).children) visit(id)
    return out
  }

  onCancel(ctx: ToolContext): void {
    this.trail = null
    ctx.overlay.setLasso(null)
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}
