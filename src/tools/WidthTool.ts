/**
 * Width tool (Shift+W): edits Style.widthProfile — the variable-width stroke
 * profile rendered as the chunked stroke-width APPROXIMATION (see
 * model/widthProfile.ts; the true filled outline lands after the
 * offset/boolean engine).
 *
 * - click a stroked object = target it (its width handles appear)
 * - click on the path = add a width point there and drag its width
 * - drag a width dot = set the width at that point (perpendicular distance)
 * - drag the spine diamond = slide the point along the path
 * - double-click a width point = delete it (last one restores uniform width)
 * One gesture = one transaction. Widths are edited in LOCAL units, so the
 * profile is stable under zoom; hit testing happens in screen pixels.
 */

import { applyToPoint, invert } from '../geometry/matrix'
import { distance } from '../geometry/vec2'
import type { NodeId, WidthStop } from '../model/types'
import {
  nearestOffsetOnPath,
  pointAtOffset,
  sortedProfile,
  widthAt,
  type SampledPath,
} from '../model/widthProfile'
import { docToScreen } from '../store/coords'
import { leafNodeIdFromTarget } from './hitTest'
import { hitWidthHandle, sampledPathOf, widthHandleLayout } from './widthEditShared'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

/** How close (px) a click must be to the spine to create a new width point. */
const SPINE_HIT_PX = 8
const MIN_WIDTH = 0.05

interface Gesture {
  nodeId: NodeId
  mode: 'width' | 'slide'
  stopIndex: number
  /** Local-space sampling captured at gesture start (geometry is static). */
  sampled: SampledPath
}

export class WidthTool implements Tool {
  readonly id = 'width'
  readonly name = 'Width'
  readonly shortcut = 'shift+w'
  readonly cursor = 'crosshair'

  private gesture: Gesture | null = null

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    const targetId = ctx.widthEdit.get()

    // 1. Handle of the current target?
    const layout = widthHandleLayout(doc.nodes, targetId, ctx.getViewport())
    if (layout && targetId) {
      const hit = hitWidthHandle(layout, e.screenPoint)
      if (hit) {
        const node = doc.nodes[targetId]
        const sampled = node ? sampledPathOf(node) : null
        if (!sampled) return
        ctx.transaction.begin(hit.kind === 'width' ? 'Adjust Width' : 'Move Width Point')
        this.gesture = { nodeId: targetId, mode: hit.kind, stopIndex: hit.index, sampled }
        return
      }
    }

    // 2. A stroked object (possibly a new target)?
    const leafId = leafNodeIdFromTarget(doc, e.domTarget)
    if (!leafId) {
      ctx.widthEdit.set(null)
      return
    }
    const node = doc.nodes[leafId]
    if (!node || node.type === 'group' || node.type === 'text' || node.style.stroke === null) {
      ctx.widthEdit.set(null)
      return
    }
    ctx.widthEdit.set(leafId)

    // 3. Close enough to the spine -> add a width point and drag it.
    const sampled = sampledPathOf(node)
    if (!sampled) return
    const world = ctx.worldTransform(leafId)
    const local = applyToPoint(invert(world), e.docPoint)
    const nearest = nearestOffsetOnPath(sampled, local)
    const spineScreen = docToScreen(ctx.getViewport(), applyToPoint(world, nearest.point))
    const strokeHalfPx =
      (widthAt(node.style.widthProfile ?? [], nearest.u, node.style.strokeWidth) / 2) *
      ctx.getViewport().zoom
    if (distance(spineScreen, e.screenPoint) > Math.max(SPINE_HIT_PX, strokeHalfPx + 4)) return

    const stop: WidthStop = {
      offset: nearest.u,
      width: widthAt(node.style.widthProfile ?? [], nearest.u, node.style.strokeWidth),
    }
    ctx.transaction.begin('Add Width Point')
    let stopIndex = 0
    ctx.commands.setStyle([leafId], 'Add Width Point', (style) => {
      const profile = style.widthProfile ?? []
      stopIndex = profile.length
      style.widthProfile = [...profile, stop]
    })
    this.gesture = { nodeId: leafId, mode: 'width', stopIndex, sampled }
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    const g = this.gesture
    if (!g) return
    const nodes = ctx.getDocument().nodes
    if (!nodes[g.nodeId]) return
    const local = applyToPoint(invert(ctx.worldTransform(g.nodeId)), e.docPoint)

    ctx.commands.setStyle([g.nodeId], 'Adjust Width', (style) => {
      const stop = style.widthProfile?.[g.stopIndex]
      if (!stop) return
      if (g.mode === 'width') {
        const { point, normal } = pointAtOffset(g.sampled, stop.offset)
        const span = Math.abs((local.x - point.x) * normal.x + (local.y - point.y) * normal.y)
        stop.width = Math.max(MIN_WIDTH, span * 2)
      } else {
        stop.offset = nearestOffsetOnPath(g.sampled, local).u
      }
    })
  }

  onPointerUp(_e: ToolPointerEvent, ctx: ToolContext): void {
    const g = this.gesture
    this.gesture = null
    if (!g) return
    // Keep the stored profile sorted (renderers sort defensively, the model
    // stays canonical). Only touch it when out of order — an untouched array
    // must produce no patches, or a plain click would leave a phantom undo
    // entry. Runs inside the same transaction, then commit.
    ctx.commands.setStyle([g.nodeId], 'Sort Width Profile', (style) => {
      const profile = style.widthProfile
      if (!profile || profile.length < 2) return
      const inOrder = profile.every((s, i) => i === 0 || profile[i - 1]!.offset <= s.offset)
      if (!inOrder) style.widthProfile = sortedProfile(profile)
    })
    ctx.transaction.commit()
  }

  onDoubleClick(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    const targetId = ctx.widthEdit.get()
    const layout = widthHandleLayout(doc.nodes, targetId, ctx.getViewport())
    if (!layout || !targetId) return
    const hit = hitWidthHandle(layout, e.screenPoint)
    if (!hit) return
    ctx.commands.setStyle([targetId], 'Delete Width Point', (style) => {
      const profile = style.widthProfile
      if (!profile) return
      profile.splice(hit.index, 1)
      if (profile.length === 0) delete style.widthProfile
    })
  }

  onCancel(_ctx: ToolContext): void {
    // The manager rolls back any open transaction.
    this.gesture = null
  }

  onDeactivate(ctx: ToolContext): void {
    ctx.widthEdit.set(null)
  }
}
