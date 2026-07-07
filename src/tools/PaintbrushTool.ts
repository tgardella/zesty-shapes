/**
 * Paintbrush (B): freehand brush strokes. Captures the pointer stream like
 * the Pencil, but the fitted path gets the brush size as its stroke width,
 * round caps/joins, and a WIDTH PROFILE from the active brush preset —
 * tapered ends, uniform, or angled-nib calligraphy (width follows stroke
 * direction) — rendered as real outlined geometry by the variable-width
 * pipeline. One stroke = one undo step.
 */

import { translate } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { distance, sub } from '../geometry/vec2'
import type { NodeId, Paint, WidthStop } from '../model/types'
import { createAnchor, createSubPath, fitPointsToSubPath } from '../model/pathOps'
import { cloneStyle, createPathNode } from '../model/nodes'
import type { BrushPreset } from '../store/store'
import { DragBehavior } from './behaviors/DragBehavior'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

const MIN_SAMPLE_PX = 2
const FIT_TOLERANCE_PX = 2.5
/** Calligraphic nib angle (radians): the classic 45° italic pen. */
const NIB_ANGLE = Math.PI / 4
/** Max width stops emitted for a calligraphic stroke. */
const CALLIG_STOPS = 12

/**
 * Width profile for one captured stroke under the given preset. `samples`
 * are the raw pointer points (LOCAL frame) — calligraphy derives width from
 * the stroke DIRECTION at each point relative to the nib angle.
 */
export function brushWidthProfile(
  preset: BrushPreset,
  width: number,
  samples: Vec2[],
): WidthStop[] | null {
  if (preset === 'uniform') return null
  if (preset === 'taper') {
    const thin = Math.max(0.1, width * 0.2)
    return [
      { offset: 0, width: thin },
      { offset: 0.15, width },
      { offset: 0.85, width },
      { offset: 1, width: thin },
    ]
  }
  // Calligraphic: width = |sin(direction - nib)| — full width when the
  // stroke crosses the nib, hairline when it runs along it.
  if (samples.length < 2) return null
  const lengths: number[] = [0]
  let total = 0
  for (let i = 1; i < samples.length; i++) {
    total += distance(samples[i]!, samples[i - 1]!)
    lengths.push(total)
  }
  if (total === 0) return null
  const stops: WidthStop[] = []
  const count = Math.min(CALLIG_STOPS, samples.length)
  for (let k = 0; k < count; k++) {
    const i = Math.round((k / (count - 1)) * (samples.length - 1))
    const prev = samples[Math.max(0, i - 1)]!
    const next = samples[Math.min(samples.length - 1, i + 1)]!
    const dir = Math.atan2(next.y - prev.y, next.x - prev.x)
    const factor = 0.15 + 0.85 * Math.abs(Math.sin(dir - NIB_ANGLE))
    stops.push({ offset: lengths[i]! / total, width: Math.max(0.1, width * factor) })
  }
  // Offsets must strictly increase for the outline builder.
  for (let k = 1; k < stops.length; k++) {
    if (stops[k]!.offset <= stops[k - 1]!.offset) stops[k]!.offset = stops[k - 1]!.offset + 1e-4
  }
  stops[stops.length - 1]!.offset = 1
  return stops
}

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
      const profile = brushWidthProfile(ctx.brush.preset(), width, this.samples)
      ctx.commands.updateNode(id, 'Paintbrush', (node) => {
        if (node.type !== 'path') return
        node.subpaths = [fitted]
        if (profile) node.style.widthProfile = profile
        else delete node.style.widthProfile
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
