/**
 * Scissors tool (toolbar-selected): click on a path to cut it.
 * - on a segment: exact de Casteljau split at the clicked point
 * - on an anchor: the anchor is duplicated and the path severed there
 * A closed subpath opens at the cut; an open subpath becomes two subpaths of
 * the same PathNode. Parametric shapes auto-convert first. One undo step.
 */

import type { NodeId, PathNode } from '../model/types'
import {
  splitSubPathAtAnchorIndex,
  splitSubPathAtSegment,
} from '../model/pathOps'
import { leafNodeIdFromTarget } from './hitTest'
import {
  anchorAtScreenPoint,
  pathNodeOf,
  segmentAtScreenPoint,
} from './pathEditShared'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

export class ScissorsTool implements Tool {
  readonly id = 'scissors'
  readonly name = 'Scissors'
  readonly shortcut = null // toolbar-selected
  readonly cursor = 'crosshair'

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    // The size selector sets the snap tolerance band (doc-space diameter).
    const tolPx = Math.max(4, (ctx.toolSize.get('scissors') / 2) * ctx.getViewport().zoom)

    // Resolve the path under the cursor (selected target first, then leaf).
    let target = pathNodeOf(doc.nodes, ctx.pathEdit.get()?.nodeId)
    const hitOnTarget =
      target &&
      (anchorAtScreenPoint(doc.nodes, target, ctx.getViewport(), e.screenPoint, tolPx) !== null ||
        segmentAtScreenPoint(doc.nodes, target, ctx.getViewport(), e.screenPoint, tolPx) !== null)
    if (!hitOnTarget) {
      const leafId = leafNodeIdFromTarget(doc, e.domTarget)
      if (!leafId) return
      const leaf = doc.nodes[leafId]!
      if (leaf.type === 'path') target = leaf as PathNode
      else if (leaf.type !== 'group' && leaf.type !== 'text') {
        const converted = ctx.commands.convertToPath([leafId])
        target = pathNodeOf(ctx.getDocument().nodes, converted[0] ?? null)
      } else {
        return
      }
    }
    if (!target) return
    const targetId: NodeId = target.id
    const nodes = ctx.getDocument().nodes
    const fresh = pathNodeOf(nodes, targetId)
    if (!fresh) return

    const anchorHit = anchorAtScreenPoint(nodes, fresh, ctx.getViewport(), e.screenPoint, tolPx)
    const segHit = anchorHit
      ? null
      : segmentAtScreenPoint(nodes, fresh, ctx.getViewport(), e.screenPoint, tolPx)
    if (!anchorHit && !segHit) return

    ctx.commands.updateNode(targetId, 'Cut Path', (node) => {
      if (node.type !== 'path') return
      const spIndex = node.subpaths.findIndex(
        (s) => s.id === (anchorHit ? anchorHit.subPathId : segHit!.subPathId),
      )
      const sp = node.subpaths[spIndex]
      if (!sp) return
      const pieces = anchorHit
        ? splitSubPathAtAnchorIndex(sp, anchorHit.index)
        : splitSubPathAtSegment(sp, segHit!.segIndex, segHit!.t)
      node.subpaths.splice(spIndex, 1, ...pieces)
    })
    ctx.select.set([targetId])
    ctx.pathEdit.set({ nodeId: targetId, anchorIds: [] })
  }
}
