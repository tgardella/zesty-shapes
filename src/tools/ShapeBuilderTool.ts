/**
 * Shape Builder (Shift+M): interactive region editing over the SELECTED
 * overlapping objects.
 * - hover highlights the atomic region (face) under the cursor
 * - click merges that region out as its own path; DRAG across several
 *   regions merges all of them into one path
 * - Alt-click / Alt-drag DELETES the gestured regions
 * The face arrangement (model/booleanOps.buildFaces) is computed lazily per
 * document+selection revision and cached on the tool. Applying a gesture
 * consumes the source objects: gestured faces become one merged path (or are
 * removed), every remaining face survives as its own path — one undo step.
 */

import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import { union, type Regions } from '../geometry/boolean'
import type { Document, NodeId } from '../model/types'
import type { Face } from '../model/booleanOps'
import { buildFaces } from '../model/booleanOps'
import { collectOperands, faceAtPoint } from '../store/booleanCommands'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

/** Doc-space distance between drag samples fed into the face picker. */
const SAMPLE_STEP = 3

export class ShapeBuilderTool implements Tool {
  readonly id = 'shape-builder'
  readonly name = 'Shape Builder'
  readonly shortcut = 'shift+m'
  readonly cursor = 'crosshair'

  private cache: { doc: Document; selectionKey: string; faces: Face[]; ids: NodeId[] } | null = null
  private gesture: { picked: number[]; alt: boolean; lastSample: Vec2 } | null = null

  private faces(ctx: ToolContext): { faces: Face[]; ids: NodeId[] } {
    const doc = ctx.getDocument()
    const selection = ctx.getSelection()
    const key = selection.join(',')
    if (this.cache && this.cache.doc === doc && this.cache.selectionKey === key) {
      return this.cache
    }
    const operands = collectOperands(doc, selection)
    const faces =
      operands.length >= 1
        ? buildFaces(
            [...operands].reverse().map((o) => ({ id: o.id, regions: o.regions, style: o.style })),
          )
        : []
    this.cache = { doc, selectionKey: key, faces, ids: operands.map((o) => o.id) }
    return this.cache
  }

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    const { faces } = this.faces(ctx)
    const hit = faceAtPoint(faces, e.docPoint)
    if (hit === -1) {
      this.gesture = null
      return
    }
    this.gesture = { picked: [hit], alt: e.modifiers.alt, lastSample: e.docPoint }
    ctx.overlay.setFacePreview(faces[hit]!.region)
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    const { faces } = this.faces(ctx)
    if (!this.gesture) {
      // Hover highlight.
      const hit = faceAtPoint(faces, e.docPoint)
      ctx.overlay.setFacePreview(hit === -1 ? null : faces[hit]!.region)
      return
    }
    // Drag: sample the trail so fast moves still pick every crossed face.
    if (distance(e.docPoint, this.gesture.lastSample) < SAMPLE_STEP) return
    this.gesture.lastSample = e.docPoint
    this.gesture.alt = e.modifiers.alt
    const hit = faceAtPoint(faces, e.docPoint)
    if (hit !== -1 && !this.gesture.picked.includes(hit)) {
      this.gesture.picked.push(hit)
    }
    // Preview = union of everything picked so far.
    const regions = union([], ...this.gesture.picked.map((i): Regions => [faces[i]!.region]))
    ctx.overlay.setFacePreview(regions[0] ?? null)
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    const gesture = this.gesture
    this.gesture = null
    ctx.overlay.setFacePreview(null)
    if (!gesture) return
    const { faces, ids } = this.faces(ctx)
    if (faces.length === 0) return
    const alt = gesture.alt || e.modifiers.alt
    ctx.commands.shapeBuilder(ids, faces, gesture.picked, alt ? 'delete' : 'merge')
    this.cache = null // document changed; rebuild on next use
  }

  onCancel(ctx: ToolContext): void {
    this.gesture = null
    ctx.overlay.setFacePreview(null)
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
    this.cache = null
  }
}
