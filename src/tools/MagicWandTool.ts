/**
 * Magic Wand (Y): click an object to select every (visible, unlocked) leaf
 * matching its primary appearance attribute within a tolerance — fill color
 * (per-channel, or matching gradient stops) for filled objects; stroke paint
 * + weight for stroke-only ones. Shift+click ADDS the matching set to the
 * selection; clicking empty space clears it.
 */

import type { Document, GroupNode, NodeId, Paint, RGBA, SceneNode } from '../model/types'
import { leafNodeAtPoint, leafNodeIdFromTarget } from './hitTest'
import type { Tool, ToolContext, ToolPointerEvent } from './types'

/** Per-channel color tolerance (0-255 space). */
export const WAND_TOLERANCE = 32

function colorsSimilar(a: RGBA, b: RGBA, tol: number): boolean {
  return (
    Math.abs(a.r - b.r) <= tol &&
    Math.abs(a.g - b.g) <= tol &&
    Math.abs(a.b - b.b) <= tol &&
    Math.abs(a.a - b.a) <= tol / 255
  )
}

/** Paint similarity: same kind; solids by color tolerance, gradients by stops. */
export function paintsSimilar(a: Paint | null, b: Paint | null, tol: number): boolean {
  if (a === null || b === null) return a === b
  if (a.type !== b.type) return false
  if (a.type === 'solid' && b.type === 'solid') return colorsSimilar(a.color, b.color, tol)
  if (a.type === 'gradient' && b.type === 'gradient') {
    if (a.gradientType !== b.gradientType || a.stops.length !== b.stops.length) return false
    return a.stops.every(
      (s, i) =>
        Math.abs(s.offset - b.stops[i]!.offset) <= 0.05 &&
        colorsSimilar(s.color, b.stops[i]!.color, tol),
    )
  }
  return false
}

/**
 * The wand's appearance match (exported for tests). Illustrator semantics:
 * the PRIMARY attribute of the clicked object decides — fill color within
 * the tolerance when the seed has a fill (differing strokes don't exclude a
 * match), otherwise stroke paint + weight for stroke-only objects.
 */
export function appearanceSimilar(a: SceneNode, b: SceneNode, tol = WAND_TOLERANCE): boolean {
  if (a.style.fill !== null) return paintsSimilar(a.style.fill, b.style.fill, tol)
  return (
    paintsSimilar(a.style.stroke, b.style.stroke, tol) &&
    (a.style.stroke === null || Math.abs(a.style.strokeWidth - b.style.strokeWidth) <= 1)
  )
}

/** All visible unlocked leaves under the root, paint order. */
function allLeaves(doc: Document): NodeId[] {
  const out: NodeId[] = []
  const visit = (id: NodeId): void => {
    const node = doc.nodes[id]
    if (!node || node.locked || node.hidden) return
    if (node.type === 'group') {
      for (const child of node.children) visit(child)
      return
    }
    out.push(id)
  }
  for (const id of (doc.nodes[doc.root] as GroupNode).children) visit(id)
  return out
}

export class MagicWandTool implements Tool {
  readonly id = 'magic-wand'
  readonly name = 'Magic Wand'
  readonly shortcut = 'y'
  readonly cursor = 'crosshair'

  onPointerDown(e: ToolPointerEvent, ctx: ToolContext): void {
    const doc = ctx.getDocument()
    const leafId =
      leafNodeIdFromTarget(doc, e.domTarget) ??
      leafNodeAtPoint(doc, e.docPoint, 4 / ctx.getViewport().zoom)
    if (!leafId) {
      if (!e.modifiers.shift) ctx.select.clear()
      return
    }
    const seed = doc.nodes[leafId]!
    const matches = allLeaves(doc).filter((id) => appearanceSimilar(seed, doc.nodes[id]!))
    if (e.modifiers.shift) ctx.select.add(matches)
    else ctx.select.set(matches)
  }
}
