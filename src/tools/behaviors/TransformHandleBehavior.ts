/**
 * Scale/rotate gestures on the selection's bounding-box handles, shared by
 * the Selection (V), Scale (S), and Rotate (R) tools.
 *
 * The gesture builds a DOC-space transform D (scale about an anchor, or
 * rotation about the bbox center) and composes it into each node's own
 * transform through the EFFECTIVE-transform math:
 *
 *   newLocal = inv(world(parent)) * D * world_base(node)
 *
 * Base world transforms are captured once at gesture start, so ancestors of
 * any depth (rotated groups included) stay exact. Live preview via the open
 * transaction; ONE undo step per gesture.
 */

import type { BBox } from '../../geometry/bbox'
import type { Mat } from '../../geometry/matrix'
import { compose, invert, multiply, rotateMat, scaleMat, translate } from '../../geometry/matrix'
import type { Vec2 } from '../../geometry/vec2'
import type { NodeId } from '../../model/types'
import { orderedSubtreeRoots } from '../../model/clone'
import {
  HANDLE_UNITS,
  hitTransformHandle,
  selectionHandleLayout,
  type TransformHandleHit,
} from '../handles'
import { DragBehavior } from './DragBehavior'
import type { ToolContext, ToolModifiers, ToolPointerEvent } from '../types'

const EPS = 1e-6
/** Snap step for Shift-rotate: 45°. */
const ROTATE_SNAP = Math.PI / 4

// ---------------------------------------------------------------------------
// Pure gesture math (unit-testable)
// ---------------------------------------------------------------------------

/** Doc-space position of handle `i` on a doc bbox (same table as the overlay). */
export function handleDocPosition(bbox: BBox, index: number): Vec2 {
  const u = HANDLE_UNITS[index]!
  return {
    x: bbox.minX + (bbox.maxX - bbox.minX) * u.x,
    y: bbox.minY + (bbox.maxY - bbox.minY) * u.y,
  }
}

/**
 * DOC-space scale transform for dragging handle `handleIndex` of `bbox` to
 * `point`. Anchor = opposite handle (Alt = bbox center). Edge handles scale
 * one axis; Shift constrains corners to uniform scale (projection onto the
 * original diagonal) and edges to uniform scale of their axis factor.
 * Negative factors (dragging past the anchor) flip — by design.
 */
export function scaleDocTransform(
  bbox: BBox,
  handleIndex: number,
  point: Vec2,
  modifiers: Pick<ToolModifiers, 'shift' | 'alt'>,
): Mat {
  const handle = handleDocPosition(bbox, handleIndex)
  const anchor = modifiers.alt
    ? { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 }
    : handleDocPosition(bbox, (handleIndex + 4) % 8)

  const unit = HANDLE_UNITS[handleIndex]!
  const scalesX = unit.x !== 0.5
  const scalesY = unit.y !== 0.5

  const dxDenom = handle.x - anchor.x
  const dyDenom = handle.y - anchor.y
  let sx = scalesX && Math.abs(dxDenom) > EPS ? (point.x - anchor.x) / dxDenom : 1
  let sy = scalesY && Math.abs(dyDenom) > EPS ? (point.y - anchor.y) / dyDenom : 1

  if (modifiers.shift) {
    if (scalesX && scalesY) {
      // Corner: project the drag onto the original anchor->handle diagonal.
      const hx = handle.x - anchor.x
      const hy = handle.y - anchor.y
      const lenSq = hx * hx + hy * hy
      const t = lenSq > EPS ? ((point.x - anchor.x) * hx + (point.y - anchor.y) * hy) / lenSq : 1
      sx = t
      sy = t
    } else {
      const f = scalesX ? sx : sy
      sx = f
      sy = f
    }
  }
  return compose(translate(anchor.x, anchor.y), scaleMat(sx, sy), translate(-anchor.x, -anchor.y))
}

/**
 * DOC-space rotation for dragging from `startPoint` to `point` about the
 * bbox center. `snap45` (Shift) quantizes the delta to 45° steps.
 */
export function rotateDocTransform(
  bbox: BBox,
  startPoint: Vec2,
  point: Vec2,
  snap45: boolean,
): Mat {
  const center = { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 }
  const a0 = Math.atan2(startPoint.y - center.y, startPoint.x - center.x)
  const a1 = Math.atan2(point.y - center.y, point.x - center.x)
  let delta = a1 - a0
  if (snap45) delta = Math.round(delta / ROTATE_SNAP) * ROTATE_SNAP
  return rotateMat(delta, center)
}

/**
 * DOC-space reflection across the axis through the bbox center at the angle of
 * the vector center->point (Illustrator's Reflect tool: drag to define the
 * mirror axis). `snap45` (Shift) quantizes the axis to 45° steps. Reflection
 * about a line at angle θ: [cos2θ, sin2θ, sin2θ, -cos2θ], sandwiched around the
 * center so the center is the fixed point.
 */
export function reflectDocTransform(bbox: BBox, point: Vec2, snap45: boolean): Mat {
  const center = { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 }
  let angle = Math.atan2(point.y - center.y, point.x - center.x)
  if (snap45) angle = Math.round(angle / ROTATE_SNAP) * ROTATE_SNAP
  const c = Math.cos(2 * angle)
  const s = Math.sin(2 * angle)
  const reflect: Mat = [c, s, s, -c, 0, 0]
  return compose(translate(center.x, center.y), reflect, translate(-center.x, -center.y))
}

/**
 * DOC-space shear (skew) about the bbox center. Dragging horizontally shears
 * along X (x += k·y, k from the horizontal drag scaled by half the bbox
 * height); Shift shears along Y instead (y += k·x, from the vertical drag).
 * The center stays fixed.
 */
export function shearDocTransform(
  bbox: BBox,
  startPoint: Vec2,
  point: Vec2,
  modifiers: Pick<ToolModifiers, 'shift'>,
): Mat {
  const center = { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 }
  const halfH = Math.max(EPS, (bbox.maxY - bbox.minY) / 2)
  const halfW = Math.max(EPS, (bbox.maxX - bbox.minX) / 2)
  let shear: Mat
  if (modifiers.shift) {
    const ky = (point.y - startPoint.y) / halfW
    shear = [1, ky, 0, 1, 0, 0]
  } else {
    const kx = (point.x - startPoint.x) / halfH
    shear = [1, 0, kx, 1, 0, 0]
  }
  return compose(translate(center.x, center.y), shear, translate(-center.x, -center.y))
}

// ---------------------------------------------------------------------------
// The gesture controller
// ---------------------------------------------------------------------------

interface GestureBase {
  ids: NodeId[]
  /** world_base per node and inv(world(parent)) per node, captured at down. */
  baseWorlds: Map<NodeId, Mat>
  parentInvs: Map<NodeId, Mat>
  bbox: BBox
  startDoc: Vec2
}

type TransformMode = 'scale' | 'rotate' | 'reflect' | 'shear'

const MODE_LABEL: Record<TransformMode, string> = {
  scale: 'Scale',
  rotate: 'Rotate',
  reflect: 'Reflect',
  shear: 'Shear',
}

export class TransformHandleController {
  private mode: TransformMode | null = null
  private handleIndex = 0
  private base: GestureBase | null = null

  private readonly drag = new DragBehavior({
    transactionLabel: () => (this.mode ? MODE_LABEL[this.mode] : 'Scale'),
    onMove: (e, ctx) => this.apply(e, ctx),
    onEnd: () => this.reset(),
    onClick: () => this.reset(),
  })

  get isActive(): boolean {
    return this.mode !== null
  }

  /**
   * Hit-test the selection's handles and arm the gesture on a hit.
   * `allow` restricts which affordances this tool responds to.
   */
  tryBegin(
    e: ToolPointerEvent,
    ctx: ToolContext,
    allow: 'scale' | 'rotate' | 'both' = 'both',
  ): boolean {
    const layout = selectionHandleLayout(ctx.getDocument().nodes, ctx.getSelection(), ctx.getViewport())
    if (!layout) return false
    const hit = hitTransformHandle(layout, e.screenPoint)
    if (!hit) return false
    if (allow !== 'both' && hit.kind !== allow) return false
    this.arm(hit, layout.bboxDoc, e, ctx)
    return true
  }

  /** Rotate-anywhere entry point (Rotate tool): no handle needed. */
  beginRotate(e: ToolPointerEvent, ctx: ToolContext): boolean {
    return this.beginMode('rotate', e, ctx)
  }

  /**
   * Drag-anywhere entry for Reflect/Shear (no handle needed): the gesture is
   * defined by the drag vector relative to the bbox center.
   */
  beginMode(mode: 'rotate' | 'reflect' | 'shear', e: ToolPointerEvent, ctx: ToolContext): boolean {
    const layout = selectionHandleLayout(ctx.getDocument().nodes, ctx.getSelection(), ctx.getViewport())
    if (!layout) return false
    this.armMode(mode, 0, layout.bboxDoc, e, ctx)
    return true
  }

  private arm(hit: TransformHandleHit, bbox: BBox, e: ToolPointerEvent, ctx: ToolContext): void {
    this.armMode(hit.kind, hit.kind === 'scale' ? hit.handleIndex : 0, bbox, e, ctx)
  }

  private armMode(
    mode: TransformMode,
    handleIndex: number,
    bbox: BBox,
    e: ToolPointerEvent,
    ctx: ToolContext,
  ): void {
    const doc = ctx.getDocument()
    const ids = orderedSubtreeRoots(doc, ctx.getSelection()).filter(
      (id) => doc.nodes[id] && !doc.nodes[id]!.locked,
    )
    if (ids.length === 0) return
    this.mode = mode
    this.handleIndex = handleIndex
    const baseWorlds = new Map<NodeId, Mat>()
    const parentInvs = new Map<NodeId, Mat>()
    for (const id of ids) {
      baseWorlds.set(id, ctx.worldTransform(id))
      const parentId = doc.nodes[id]!.parent
      parentInvs.set(
        id,
        parentId === null || parentId === doc.root
          ? ([1, 0, 0, 1, 0, 0] as Mat)
          : invert(ctx.worldTransform(parentId)),
      )
    }
    this.base = { ids, baseWorlds, parentInvs, bbox, startDoc: e.docPoint }
    this.drag.down(e)
  }

  move(e: ToolPointerEvent, ctx: ToolContext): void {
    this.drag.move(e, ctx)
  }

  up(e: ToolPointerEvent, ctx: ToolContext): void {
    this.drag.up(e, ctx)
  }

  cancel(ctx: ToolContext): void {
    this.drag.cancel(ctx)
    this.reset()
  }

  private apply(e: ToolPointerEvent, ctx: ToolContext): void {
    if (!this.base || !this.mode) return
    let D: Mat
    switch (this.mode) {
      case 'scale':
        D = scaleDocTransform(this.base.bbox, this.handleIndex, e.snappedPoint, e.modifiers)
        break
      case 'rotate':
        D = rotateDocTransform(this.base.bbox, this.base.startDoc, e.docPoint, e.modifiers.shift)
        break
      case 'reflect':
        D = reflectDocTransform(this.base.bbox, e.docPoint, e.modifiers.shift)
        break
      case 'shear':
        D = shearDocTransform(this.base.bbox, this.base.startDoc, e.docPoint, e.modifiers)
        break
    }
    const entries = this.base.ids.map((id) => ({
      id,
      transform: multiply(this.base!.parentInvs.get(id)!, multiply(D, this.base!.baseWorlds.get(id)!)),
    }))
    ctx.commands.setTransforms(entries, MODE_LABEL[this.mode])
  }

  private reset(): void {
    this.mode = null
    this.base = null
  }
}
