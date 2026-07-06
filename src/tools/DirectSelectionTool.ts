/**
 * Direct Selection tool (A): anchor/handle editing at any nesting depth.
 * All geometry goes screen -> doc -> world -> LOCAL through worldTransform,
 * so anchors of rotated/grouped paths track the cursor exactly.
 *
 * - click a path (leaf, even inside groups) = target it; parametric shapes
 *   auto-convert to paths on click (spec: deep tools auto-convert inputs)
 * - click anchor = select (Shift = add/remove); drag = move all selected
 *   anchors (handles travel along); one undo step per drag
 * - drag a handle dot = reshape; symmetric mirrors exactly, smooth mirrors
 *   direction keeping the other length, Alt BREAKS symmetry (independent)
 * - double-click anchor = toggle corner <-> smooth
 * - marquee = select anchors inside the rect; Delete = delete anchors
 */

import { applyToVector, invert } from '../geometry/matrix'
import type { Vec2 } from '../geometry/vec2'
import { add } from '../geometry/vec2'
import type { AnchorId, NodeId } from '../model/types'
import { autoSmoothSubPath, mirrorOppositeHandle } from '../model/pathOps'
import { worldTransform } from '../store/worldTransform'
import { DragBehavior } from './behaviors/DragBehavior'
import { MarqueeBehavior } from './behaviors/MarqueeBehavior'
import { leafNodeIdFromTarget } from './hitTest'
import {
  anchorAtScreenPoint,
  docPointToLocal,
  handleAtScreenPoint,
  pathNodeOf,
  type HandleHit,
} from './pathEditShared'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

export class DirectSelectionTool implements Tool {
  readonly id = 'direct-selection'
  readonly name = 'Direct Selection'
  readonly shortcut = 'a'
  readonly cursor = 'default'

  private readonly marquee = new MarqueeBehavior()
  private targetId: NodeId | null = null
  private handleRef: HandleHit | null = null
  private pressedAnchorId: AnchorId | null = null
  /** Shift-clicked an already-selected anchor: deselect on up unless dragged. */
  private deselectOnUp: AnchorId | null = null
  /** Base LOCAL anchor geometry captured at drag start. */
  private basePoints = new Map<AnchorId, { point: Vec2; in: Vec2 | null; out: Vec2 | null }>()

  private readonly anchorDrag = new DragBehavior({
    transactionLabel: 'Move Anchors',
    onStart: (_e, ctx) => this.captureBase(ctx),
    onMove: (e, ctx) => {
      const id = this.targetId
      if (!id) return
      const nodes = ctx.getDocument().nodes
      // Doc delta -> LOCAL delta via the inverse world transform (linear part).
      const localDelta = applyToVector(invert(worldTransform(nodes, id)), e.deltaFromDown)
      ctx.commands.updateNode(id, 'Move Anchors', (node) => {
        if (node.type !== 'path') return
        for (const sp of node.subpaths) {
          for (const a of sp.anchors) {
            const base = this.basePoints.get(a.id)
            if (!base) continue
            a.point = add(base.point, localDelta)
            a.handleIn = base.in ? add(base.in, localDelta) : null
            a.handleOut = base.out ? add(base.out, localDelta) : null
          }
        }
      })
    },
    onEnd: () => {
      this.basePoints.clear()
      this.deselectOnUp = null
    },
    onClick: (_e, ctx) => {
      if (this.deselectOnUp) {
        const pe = ctx.pathEdit.get()
        if (pe) {
          ctx.pathEdit.set({
            ...pe,
            anchorIds: pe.anchorIds.filter((a) => a !== this.deselectOnUp),
          })
        }
      }
      this.deselectOnUp = null
    },
  })

  private readonly handleDrag = new DragBehavior(
    {
      transactionLabel: 'Adjust Handle',
      onMove: (e, ctx) => {
        const ref = this.handleRef
        const id = this.targetId
        if (!ref || !id) return
        const nodes = ctx.getDocument().nodes
        const local = docPointToLocal(nodes, id, e.docPoint)
        ctx.commands.updateNode(id, 'Adjust Handle', (node) => {
          if (node.type !== 'path') return
          const sp = node.subpaths.find((s) => s.id === ref.subPathId)
          const anchor = sp?.anchors.find((a) => a.id === ref.anchorId)
          if (!anchor) return
          if (e.modifiers.alt) anchor.type = 'corner' // break symmetry
          if (ref.end === 'in') anchor.handleIn = local
          else anchor.handleOut = local
          mirrorOppositeHandle(anchor, ref.end)
        })
      },
      onEnd: () => {
        this.handleRef = null
      },
      onClick: () => {
        this.handleRef = null
      },
    },
    0, // engage on first movement
  )

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    const pe = ctx.pathEdit.get()
    const target = pathNodeOf(doc.nodes, pe?.nodeId)

    if (target && pe) {
      // 1. Handle dots of selected anchors win.
      const handleHit = handleAtScreenPoint(
        doc.nodes,
        target,
        ctx.getViewport(),
        new Set(pe.anchorIds),
        e.screenPoint,
      )
      if (handleHit) {
        this.targetId = target.id
        this.handleRef = handleHit
        this.handleDrag.down(e)
        return
      }
      // 2. Anchors of the edit target.
      const anchorHit = anchorAtScreenPoint(doc.nodes, target, ctx.getViewport(), e.screenPoint)
      if (anchorHit) {
        this.targetId = target.id
        this.pressedAnchorId = anchorHit.anchorId
        const selected = pe.anchorIds.includes(anchorHit.anchorId)
        if (e.modifiers.shift) {
          if (selected) this.deselectOnUp = anchorHit.anchorId
          else ctx.pathEdit.set({ ...pe, anchorIds: [...pe.anchorIds, anchorHit.anchorId] })
        } else if (!selected) {
          ctx.pathEdit.set({ ...pe, anchorIds: [anchorHit.anchorId] })
        }
        this.anchorDrag.down(e)
        return
      }
    }

    // 3. A path (or shape) leaf anywhere in the tree becomes the new target.
    const leafId = leafNodeIdFromTarget(doc, e.domTarget)
    if (leafId) {
      const leaf = doc.nodes[leafId]!
      let pathId: NodeId | null = null
      if (leaf.type === 'path') {
        pathId = leafId
      } else if (leaf.type !== 'group' && leaf.type !== 'text') {
        // Deep tools auto-convert parametric shapes on edit.
        const converted = ctx.commands.convertToPath([leafId])
        pathId = converted[0] ?? null
      }
      if (pathId) {
        ctx.select.set([pathId])
        ctx.pathEdit.set({ nodeId: pathId, anchorIds: [] })
        this.targetId = pathId
      }
      return
    }

    // 4. Empty canvas: marquee-select anchors (or clear on plain click).
    this.marquee.begin(e)
  }

  onPointerMove(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.handleRef || this.handleDrag.isArmed) {
      this.handleDrag.move(e, ctx)
      return
    }
    if (this.marquee.isActive) {
      this.marquee.update(e, ctx)
      return
    }
    this.anchorDrag.move(e, ctx)
  }

  onPointerUp(e: ToolPointerEvent, ctx: ToolContext): void {
    if (this.handleRef || this.handleDrag.isArmed) {
      this.handleDrag.up(e, ctx)
      return
    }
    if (this.marquee.isActive) {
      const rect = this.marquee.end(e, ctx)
      const pe = ctx.pathEdit.get()
      const doc = ctx.getDocument()
      const target = pathNodeOf(doc.nodes, pe?.nodeId)
      if (rect && target && pe) {
        const world = worldTransform(doc.nodes, target.id)
        const inside: AnchorId[] = []
        for (const sp of target.subpaths) {
          for (const a of sp.anchors) {
            const w = { x: 0, y: 0 }
            w.x = world[0] * a.point.x + world[2] * a.point.y + world[4]
            w.y = world[1] * a.point.x + world[3] * a.point.y + world[5]
            if (w.x >= rect.minX && w.x <= rect.maxX && w.y >= rect.minY && w.y <= rect.maxY) {
              inside.push(a.id)
            }
          }
        }
        ctx.pathEdit.set({
          ...pe,
          anchorIds: e.modifiers.shift ? [...new Set([...pe.anchorIds, ...inside])] : inside,
        })
      } else if (!rect && !e.modifiers.shift) {
        // Plain click on empty canvas: drop the edit target entirely.
        ctx.pathEdit.set(null)
        ctx.select.clear()
        this.targetId = null
      }
      return
    }
    this.anchorDrag.up(e, ctx)
    this.pressedAnchorId = null
  }

  /** Double-click an anchor: toggle corner <-> smooth. */
  onDoubleClick(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    const pe = ctx.pathEdit.get()
    const target = pathNodeOf(doc.nodes, pe?.nodeId)
    if (!target) return
    const hit = anchorAtScreenPoint(doc.nodes, target, ctx.getViewport(), e.screenPoint)
    if (!hit) return
    ctx.commands.updateNode(target.id, 'Convert Anchor', (node) => {
      if (node.type !== 'path') return
      const sp = node.subpaths.find((s) => s.id === hit.subPathId)
      const anchor = sp?.anchors.find((a) => a.id === hit.anchorId)
      if (!sp || !anchor) return
      if (anchor.type === 'corner') {
        anchor.type = 'smooth'
        // Give it tangent handles from its neighborhood.
        const others = new Map(sp.anchors.map((a) => [a.id, a.type] as const))
        for (const a of sp.anchors) if (a.id !== anchor.id) a.type = 'corner'
        autoSmoothSubPath(sp)
        for (const a of sp.anchors) {
          const prev = others.get(a.id)
          if (a.id !== anchor.id && prev) a.type = prev
        }
      } else {
        anchor.type = 'corner'
        anchor.handleIn = null
        anchor.handleOut = null
      }
    })
  }

  onKeyDown(e: KeyboardEvent, ctx: ToolContext): boolean | void {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    const pe = ctx.pathEdit.get()
    if (!pe || pe.anchorIds.length === 0) return
    ctx.commands.deleteAnchors(pe.nodeId, pe.anchorIds)
    const doc = ctx.getDocument()
    ctx.pathEdit.set(doc.nodes[pe.nodeId] ? { nodeId: pe.nodeId, anchorIds: [] } : null)
    return true
  }

  onCancel(ctx: ToolContext): void {
    this.anchorDrag.cancel(ctx)
    this.handleDrag.cancel(ctx)
    this.marquee.cancel(ctx)
    this.handleRef = null
    this.deselectOnUp = null
    this.basePoints.clear()
  }

  onDeactivate(ctx: ToolContext): void {
    this.onCancel(ctx)
    ctx.pathEdit.set(null)
  }

  private captureBase(ctx: ToolContext): void {
    const pe = ctx.pathEdit.get()
    const target = pathNodeOf(ctx.getDocument().nodes, pe?.nodeId)
    if (!pe || !target) return
    this.targetId = target.id
    // Ensure the pressed anchor is part of the moving set.
    const moving = new Set(pe.anchorIds)
    if (this.pressedAnchorId) moving.add(this.pressedAnchorId)
    this.basePoints.clear()
    for (const sp of target.subpaths) {
      for (const a of sp.anchors) {
        if (!moving.has(a.id)) continue
        this.basePoints.set(a.id, {
          point: { ...a.point },
          in: a.handleIn ? { ...a.handleIn } : null,
          out: a.handleOut ? { ...a.handleOut } : null,
        })
      }
    }
    this.deselectOnUp = null // a real drag never deselects
  }
}
