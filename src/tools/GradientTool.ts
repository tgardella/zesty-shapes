/**
 * Gradient tool (G):
 * - drag across an object = apply/reorient a gradient on the ACTIVE paint
 *   slot (ui.styleTarget): the drag start/end become the axis (linear) or the
 *   center/radius (radial), written into paint.transform in each node's LOCAL
 *   space. Solids convert to a 2-stop fade of their own color; existing
 *   gradients keep their stops and type.
 * - drag an annotator endpoint = move just that end of the axis (linear) or
 *   recenter / resize (radial).
 * - click an object = select it (annotator appears if it has a gradient).
 * One drag = one transaction. Stops are edited in the Appearance panel.
 */

import { applyToPoint, invert, type Mat } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { distance } from '../geometry/vec2'
import type { GradientPaint, NodeId, SceneNode, Style } from '../model/types'
import {
  defaultGradientFrom,
  defaultGradientTransform,
  linearAxisOf,
  linearAxisTransform,
  radialAxisOf,
  radialCircleTransform,
} from '../model/gradientGeometry'
import { stylableLeafIds } from '../store/commands'
import { gradientAnnotatorLayout, hitGradientHandle, type GradientHandleKind } from './gradientAnnotator'
import { leafNodeIdFromTarget } from './hitTest'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

const DRAG_THRESHOLD_PX = 3
const MIN_AXIS_LEN = 1e-3

type Gesture =
  | { kind: 'handle'; nodeId: NodeId; handle: GradientHandleKind; active: boolean }
  | { kind: 'axis'; targetIds: NodeId[]; downDoc: Vec2; active: boolean }
  | null

export class GradientTool implements Tool {
  readonly id = 'gradient'
  readonly name = 'Gradient'
  readonly shortcut = 'g'
  readonly cursor = 'crosshair'

  private gesture: Gesture = null

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    const state = {
      nodes: doc.nodes,
      selection: ctx.getSelection(),
      target: ctx.style.target(),
      viewport: ctx.getViewport(),
    }

    // 1. Annotator endpoint?
    const layout = gradientAnnotatorLayout(state.nodes, state.selection, state.target, state.viewport)
    if (layout) {
      const handle = hitGradientHandle(layout, e.screenPoint)
      if (handle) {
        this.gesture = { kind: 'handle', nodeId: layout.nodeId, handle, active: false }
        return
      }
    }

    // 2. Object under the cursor: (re)select, then arm the axis drag.
    const leafId = leafNodeIdFromTarget(doc, e.domTarget)
    if (leafId && !state.selection.includes(leafId)) {
      ctx.select.set([leafId])
    }
    const ids = stylableLeafIds(doc.nodes, ctx.getSelection(), doc.root)
    if (ids.length > 0) {
      this.gesture = { kind: 'axis', targetIds: ids, downDoc: e.docPoint, active: false }
    }
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    const g = this.gesture
    if (!g) return
    if (!g.active) {
      const dx = e.screenDeltaFromDown.x
      const dy = e.screenDeltaFromDown.y
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      g.active = true
      ctx.transaction.begin(g.kind === 'handle' ? 'Adjust Gradient' : 'Apply Gradient')
    }
    if (g.kind === 'handle') this.dragHandle(g, e, ctx)
    else this.dragAxis(g, e, ctx)
  }

  onPointerUp(_e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.gesture?.active) ctx.transaction.commit()
    this.gesture = null
  }

  onCancel(_ctx: ToolContext): void {
    // The manager rolls back any open transaction.
    this.gesture = null
  }

  /** Move one endpoint of the selected node's gradient. */
  private dragHandle(
    g: Extract<NonNullable<Gesture>, { kind: 'handle' }>,
    e: ToolPointerEvent,
    ctx: ToolContext,
  ): void {
    const nodes = ctx.getDocument().nodes
    if (!nodes[g.nodeId]) return
    const target = ctx.style.target()
    const local = applyToPoint(invert(ctx.worldTransform(g.nodeId)), e.docPoint)

    ctx.commands.setStyle([g.nodeId], 'Adjust Gradient', (style) => {
      const paint = style[target]
      if (!paint || paint.type !== 'gradient') return
      if (paint.gradientType === 'linear') {
        const axis = linearAxisOf(paint)
        const a = g.handle === 'start' ? local : axis.a
        const b = g.handle === 'start' ? axis.b : local
        if (distance(a, b) < MIN_AXIS_LEN) return
        paint.transform = linearAxisTransform(a, b)
      } else {
        const { center, edge } = radialAxisOf(paint)
        if (g.handle === 'start') {
          // Recenter, radius preserved.
          paint.transform = radialCircleTransform(local, Math.max(distance(center, edge), MIN_AXIS_LEN))
        } else {
          const r = distance(center, local)
          if (r < MIN_AXIS_LEN) return
          paint.transform = radialCircleTransform(center, r)
        }
      }
    })
  }

  /** Drag across objects: axis -> transform per node, converting solids. */
  private dragAxis(
    g: Extract<NonNullable<Gesture>, { kind: 'axis' }>,
    e: ToolPointerEvent,
    ctx: ToolContext,
  ): void {
    const nodes = ctx.getDocument().nodes
    const target = ctx.style.target()
    // Per-node inverse worlds, computed OUTSIDE the recipe (styles don't move nodes).
    const inverseWorlds = new Map<NodeId, Mat>()
    for (const id of g.targetIds) {
      if (nodes[id]) inverseWorlds.set(id, invert(ctx.worldTransform(id)))
    }

    ctx.commands.setStyle(g.targetIds, 'Apply Gradient', (style, node) => {
      const inv = inverseWorlds.get(node.id)
      if (!inv) return
      const a = applyToPoint(inv, g.downDoc)
      const b = applyToPoint(inv, e.docPoint)
      const paint = ensureGradient(style, target, node.id, nodes)
      if (!paint) return
      if (paint.gradientType === 'linear') {
        if (distance(a, b) < MIN_AXIS_LEN) return
        paint.transform = linearAxisTransform(a, b)
      } else {
        const r = distance(a, b)
        if (r < MIN_AXIS_LEN) return
        paint.transform = radialCircleTransform(a, r)
      }
    })
  }
}

/**
 * Coerce the target slot to a gradient, preserving an existing gradient's
 * stops/type and fading a solid out of its own color. A `null` slot gets a
 * neutral gray fade so dragging on a no-fill object still works predictably.
 */
function ensureGradient(
  style: Style,
  target: 'fill' | 'stroke',
  nodeId: NodeId,
  nodes: Record<NodeId, SceneNode>,
): GradientPaint | null {
  const existing = style[target]
  if (existing && existing.type === 'gradient') return existing
  const node = nodes[nodeId]
  if (!node) return null
  const from =
    existing && existing.type === 'solid' ? existing.color : { r: 128, g: 128, b: 128, a: 1 }
  const paint = defaultGradientFrom(from, 'linear', defaultGradientTransform(node, nodes, 'linear'))
  style[target] = paint
  return paint
}
