/**
 * Pencil tool (N): freehand drawing. The raw pointer stream is captured
 * (with a minimum screen-distance filter), shown live as a polyline, then on
 * release fitted to a smooth bezier path: Ramer-Douglas-Peucker finds the
 * significant points and Catmull-Rom tangents give continuous handles. The
 * whole stroke — capture, fit, replace — happens inside ONE transaction.
 */

import { translate } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { distance, sub } from '../geometry/vec2'
import type { NodeId } from '../model/types'
import { createAnchor, createSubPath, fitPointsToSubPath } from '../model/pathOps'
import { createPathNode, defaultStyle } from '../model/nodes'
import { DragBehavior } from './behaviors/DragBehavior'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

/** Min screen px between captured samples (noise filter). */
const MIN_SAMPLE_PX = 2
/** RDP tolerance in screen px (converted to doc units by zoom at fit time). */
const FIT_TOLERANCE_PX = 2.5

export class PencilTool implements Tool {
  readonly id = 'pencil'
  readonly name = 'Pencil'
  readonly shortcut = 'n'
  readonly cursor = 'crosshair'

  private draftId: NodeId | null = null
  /** Raw samples in the node's LOCAL frame (= doc offsets from the first point). */
  private samples: Vec2[] = []
  private origin: Vec2 = { x: 0, y: 0 }
  private lastScreen: Vec2 = { x: 0, y: 0 }

  private readonly drag = new DragBehavior({
    transactionLabel: 'Pencil',
    onStart: (e, ctx) => {
      this.samples = [{ x: 0, y: 0 }]
      this.lastScreen = e.screenPoint
      const style = defaultStyle()
      style.fill = null
      const node = createPathNode(
        [createSubPath([createAnchor({ x: 0, y: 0 })], false)],
        { transform: translate(this.origin.x, this.origin.y), style },
      )
      this.draftId = node.id
      ctx.commands.addNode(node)
    },
    onMove: (e, ctx) => {
      if (!this.draftId) return
      if (distance(e.screenPoint, this.lastScreen) < MIN_SAMPLE_PX) return
      this.lastScreen = e.screenPoint
      this.samples.push(sub(e.docPoint, this.origin))
      const pts = this.samples
      ctx.commands.updateNode(this.draftId, 'Pencil', (node) => {
        if (node.type !== 'path') return
        const sp = node.subpaths[0]
        if (!sp) return
        // Live preview: raw polyline (corner anchors, no handles).
        sp.anchors = pts.map((p) => createAnchor(p))
      })
    },
    onEnd: (_e, ctx) => {
      const id = this.draftId
      this.draftId = null
      if (!id) return
      if (this.samples.length < 2) {
        ctx.transaction.cancel()
        return
      }
      const tolerance = FIT_TOLERANCE_PX / ctx.getViewport().zoom
      const fitted = fitPointsToSubPath(this.samples, tolerance)
      if (!fitted) {
        ctx.transaction.cancel()
        return
      }
      ctx.commands.updateNode(id, 'Pencil', (node) => {
        if (node.type !== 'path') return
        node.subpaths = [fitted]
      })
      ctx.select.set([id])
      ctx.pathEdit.set({ nodeId: id, anchorIds: [] })
      this.samples = []
    },
    onClick: () => {
      this.draftId = null
      this.samples = []
    },
  })

  onPointerDown(e: ToolPointerEvent, _ctx: ToolContext): void {
    this.origin = e.docPoint
    this.drag.down(e)
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    this.drag.move(e, ctx)
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    this.drag.up(e, ctx)
  }

  onCancel(ctx: ToolContext): void {
    this.drag.cancel(ctx)
    this.draftId = null
    this.samples = []
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
  }
}
