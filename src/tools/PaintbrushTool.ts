/**
 * Paintbrush (B): freehand calligraphic strokes. Captures the pointer stream
 * like the Pencil, but the fitted path gets the brush size as its stroke
 * width, round caps/joins, and a tapered width profile — rendered as real
 * outlined geometry by the existing variable-width pipeline. One stroke =
 * one undo step.
 */

import { translate } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { distance, sub } from '../geometry/vec2'
import type { NodeId, Paint } from '../model/types'
import { createAnchor, createSubPath, fitPointsToSubPath } from '../model/pathOps'
import { cloneStyle, createPathNode } from '../model/nodes'
import { DragBehavior } from './behaviors/DragBehavior'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

const MIN_SAMPLE_PX = 2
const FIT_TOLERANCE_PX = 2.5

/** The brush paint: the current stroke, falling back to the fill, then black. */
function brushPaint(ctx: ToolContext): Paint {
  const style = ctx.style.current()
  const source = style.stroke ?? style.fill
  return source
    ? (JSON.parse(JSON.stringify(source)) as Paint)
    : { type: 'solid', color: { r: 30, g: 30, b: 30, a: 1 } }
}

export class PaintbrushTool implements Tool {
  readonly id = 'paintbrush'
  readonly name = 'Paintbrush'
  readonly shortcut = 'b'
  readonly cursor = 'crosshair'

  private draftId: NodeId | null = null
  private samples: Vec2[] = []
  private origin: Vec2 = { x: 0, y: 0 }
  private lastScreen: Vec2 = { x: 0, y: 0 }

  private readonly drag = new DragBehavior({
    transactionLabel: 'Paintbrush',
    onStart: (e, ctx) => {
      this.samples = [{ x: 0, y: 0 }]
      this.lastScreen = e.screenPoint
      const width = ctx.toolSize.get('paintbrush')
      const style = cloneStyle(ctx.style.current())
      style.fill = null
      style.stroke = brushPaint(ctx)
      style.strokeWidth = width
      style.strokeCap = 'round'
      style.strokeJoin = 'round'
      style.strokeDash = []
      delete style.widthProfile
      const node = createPathNode(
        [createSubPath([createAnchor({ x: 0, y: 0 })], false)],
        { name: 'Brush Stroke', transform: translate(this.origin.x, this.origin.y), style },
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
      ctx.commands.updateNode(this.draftId, 'Paintbrush', (node) => {
        if (node.type !== 'path') return
        const sp = node.subpaths[0]
        if (!sp) return
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
      const width = ctx.toolSize.get('paintbrush')
      ctx.commands.updateNode(id, 'Paintbrush', (node) => {
        if (node.type !== 'path') return
        node.subpaths = [fitted]
        // Calligraphic taper: thin entry and exit, full body in between.
        node.style.widthProfile = [
          { offset: 0, width: Math.max(0.1, width * 0.2) },
          { offset: 0.15, width },
          { offset: 0.85, width },
          { offset: 1, width: Math.max(0.1, width * 0.2) },
        ]
      })
      ctx.select.set([id])
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
