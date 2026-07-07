/**
 * Artwork brush placement (Paintbrush, B — scatter / pattern / art brushes).
 * Given the drawn trail (DOC space) and a brush definition, places copies of
 * the active symbol (or a fallback dot) along the path in a single group, ONE
 * undo step. Scatter jitters copies along the path; pattern tiles them evenly
 * and rotates them to the tangent; art stretches one artwork to follow the
 * whole path (a filled warp of the symbol's outline).
 */

import type { Vec2 } from '../geometry/vec2'
import type { NodeId, RGBA, SceneNode, SubPath } from '../model/types'
import type { BrushDef } from '../model/brushLibrary'
import { addNode, getWorldTransform } from '../model/document'
import { cloneSubtrees } from '../model/clone'
import { createEllipseNode, createGroupNode, createPathNode } from '../model/nodes'
import { createAnchor, createSubPath } from '../model/pathOps'
import { nodeRegionsInDoc } from '../model/booleanOps'
import { symbolById, symbolDefBounds } from './symbolCommands'
import {
  applyToPoint,
  compose,
  invert,
  multiply,
  rotateMat,
  scaleMat,
  translate,
  type Mat,
} from '../geometry/matrix'
import { resolveInsertionParent, type EditorStoreApi } from './store'

export interface BrushArtworkParams {
  brush: BrushDef
  /** The drawn trail, DOC space. */
  polyline: Vec2[]
  /** Brush diameter, DOC units (dot size / fallback stroke width). */
  size: number
  /** Fallback fill for the dot / plain art stroke. */
  color: RGBA
  /** Active library symbol (the brush art), or null to use the dot fallback. */
  symbolId: string | null
}

interface ArcTable {
  poly: Vec2[]
  cum: number[]
  total: number
}

function arcTable(poly: Vec2[]): ArcTable {
  const cum = [0]
  for (let i = 1; i < poly.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(poly[i]!.x - poly[i - 1]!.x, poly[i]!.y - poly[i - 1]!.y))
  }
  return { poly, cum, total: cum[cum.length - 1] ?? 0 }
}

function sampleAt(t: ArcTable, s: number): { pos: Vec2; angle: number } {
  const target = Math.max(0, Math.min(t.total, s))
  let i = 1
  while (i < t.poly.length - 1 && t.cum[i]! < target) i++
  const a = t.poly[i - 1]!
  const b = t.poly[i]!
  const seg = t.cum[i]! - t.cum[i - 1]!
  const f = seg === 0 ? 0 : (target - t.cum[i - 1]!) / seg
  return {
    pos: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f },
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  }
}

interface Placement {
  nodes: SceneNode[]
  rootIds: NodeId[]
}

/** Clone the symbol def once, placed by world matrix `m`, under the group. */
function stampSymbol(
  store: EditorStoreApi,
  symbolId: string,
  m: Mat,
  groupWorldInv: Mat,
): Placement | null {
  const def = symbolById(store, symbolId)
  if (!def) return null
  const bounds = symbolDefBounds(def)
  if (!bounds) return null
  const center: Vec2 = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
  const centered = multiply(m, translate(-center.x, -center.y))
  const clones = cloneSubtrees(def.nodes, def.rootIds)
  for (let i = 0; i < def.rootIds.length; i++) {
    const clone = clones.nodes.find((n) => n.id === clones.rootIds[i])!
    const defWorld = getWorldTransform(def.nodes, def.rootIds[i]!)
    clone.transform = multiply(groupWorldInv, multiply(centered, defWorld))
  }
  return { nodes: clones.nodes, rootIds: clones.rootIds }
}

/** A solid dot instance placed by world matrix `m`, under the group. */
function stampDot(m: Mat, groupWorldInv: Mat, size: number, color: RGBA): Placement {
  const node = createEllipseNode({ cx: 0, cy: 0, rx: size / 2, ry: size / 2 })
  node.transform = multiply(groupWorldInv, m)
  node.style.fill = { type: 'solid', color: { ...color } }
  node.style.stroke = null
  return { nodes: [node], rootIds: [node.id] }
}

/** Symbol size (max bounding dimension) for spacing; falls back to `size`. */
function artworkSize(store: EditorStoreApi, symbolId: string | null, size: number): number {
  if (symbolId) {
    const def = symbolById(store, symbolId)
    const b = def ? symbolDefBounds(def) : null
    if (b) {
      const d = Math.max(b.maxX - b.minX, b.maxY - b.minY)
      if (d > 0.5) return d
    }
  }
  return Math.max(2, size)
}

/** All DOC-space outline regions of a symbol definition (flattened leaves). */
function symbolOutlineRegions(store: EditorStoreApi, symbolId: string): Vec2[][] {
  const def = symbolById(store, symbolId)
  if (!def) return []
  const rings: Vec2[][] = []
  for (const rootId of def.rootIds) {
    for (const region of nodeRegionsInDoc(def.nodes, rootId)) rings.push(...region)
  }
  return rings.filter((r) => r.length >= 3)
}

/** Representative solid fill of a symbol (first leaf), or the fallback color. */
function symbolFill(store: EditorStoreApi, symbolId: string, fallback: RGBA): RGBA {
  const def = symbolById(store, symbolId)
  if (def) {
    for (const id of Object.keys(def.nodes)) {
      const fill = def.nodes[id]!.style.fill
      if (fill && fill.type === 'solid') return { ...fill.color }
    }
  }
  return { ...fallback }
}

/** Warp a symbol's outline to follow the path: x -> arc length, y -> normal. */
function artWarpPlacement(
  store: EditorStoreApi,
  params: BrushArtworkParams,
  arc: ArcTable,
  groupWorldInv: Mat,
): Placement | null {
  if (!params.symbolId) return null
  const rings = symbolOutlineRegions(store, params.symbolId)
  if (rings.length === 0) return null
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const ring of rings)
    for (const p of ring) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
  const w = maxX - minX || 1
  const h = maxY - minY || 1
  const midY = (minY + maxY) / 2
  const sy = params.size / h
  const subpaths: SubPath[] = rings.map((ring) => {
    const anchors = ring.map((v) => {
      const u = (v.x - minX) / w
      const s = sampleAt(arc, u * arc.total)
      const nx = -Math.sin(s.angle)
      const ny = Math.cos(s.angle)
      const off = (v.y - midY) * sy
      const doc = { x: s.pos.x + nx * off, y: s.pos.y + ny * off }
      return createAnchor(applyToPoint(groupWorldInv, doc))
    })
    return createSubPath(anchors, true)
  })
  const node = createPathNode(subpaths, { name: 'Art Brush' })
  node.style.fill = { type: 'solid', color: symbolFill(store, params.symbolId, params.color) }
  node.style.stroke = null
  node.style.fillRule = 'evenodd'
  return { nodes: [node], rootIds: [node.id] }
}

/** Plain stroke fallback for the art brush with no symbol: the trail itself. */
function strokePlacement(params: BrushArtworkParams, groupWorldInv: Mat): Placement {
  const anchors = params.polyline.map((p) => createAnchor(applyToPoint(groupWorldInv, p)))
  const node = createPathNode([createSubPath(anchors, false)], { name: 'Brush Stroke' })
  node.style.fill = null
  node.style.stroke = { type: 'solid', color: { ...params.color } }
  node.style.strokeWidth = params.size
  node.style.strokeCap = 'round'
  node.style.strokeJoin = 'round'
  return { nodes: [node], rootIds: [node.id] }
}

const MAX_INSTANCES = 800

/**
 * Place the brush artwork along the trail, returning the new group id (or null
 * for a degenerate stroke). The whole placement is ONE undo step.
 */
export function cmdBrushArtwork(store: EditorStoreApi, params: BrushArtworkParams): NodeId | null {
  const poly = params.polyline
  if (poly.length < 2) return null
  const arc = arcTable(poly)
  if (arc.total <= 0.5) return null

  const state = store.getState()
  const parentId = resolveInsertionParent(state)
  const groupWorldInv = invert(getWorldTransform(state.document.nodes, parentId))

  const collected: SceneNode[] = []
  const rootIds: NodeId[] = []
  const add = (p: Placement | null): void => {
    if (!p) return
    collected.push(...p.nodes)
    rootIds.push(...p.rootIds)
  }

  if (params.brush.kind === 'art') {
    add(artWarpPlacement(store, params, arc, groupWorldInv) ?? strokePlacement(params, groupWorldInv))
  } else {
    // scatter / pattern: tile copies along the arc length.
    const base = artworkSize(store, params.symbolId, params.size)
    const spacing = Math.max(2, (params.brush.spacing ?? 1) * base)
    const jitterS = params.brush.kind === 'scatter'
    for (let s = 0, n = 0; s <= arc.total && n < MAX_INSTANCES; s += spacing, n++) {
      const at = jitterS ? s + (Math.random() - 0.5) * spacing * 0.6 : s
      const sample = sampleAt(arc, at)
      const rot =
        (params.brush.followPath ? sample.angle : 0) +
        (Math.random() - 0.5) * 2 * (params.brush.rotationJitter ?? 0)
      const scale = 1 + (Math.random() - 0.5) * 2 * (params.brush.scaleJitter ?? 0)
      const m = compose(translate(sample.pos.x, sample.pos.y), rotateMat(rot), scaleMat(Math.max(0.05, scale)))
      add(
        params.symbolId
          ? stampSymbol(store, params.symbolId, m, groupWorldInv)
          : stampDot(m, groupWorldInv, params.size, params.color),
      )
    }
  }

  if (rootIds.length === 0) return null
  const group = createGroupNode({ name: brushGroupName(params.brush) })

  store.getState().applyCommand(
    'Paint Brush',
    (draft) => {
      addNode(draft, group, parentId)
      for (const node of collected) {
        if (draft.nodes[node.id]) throw new Error(`brush: id collision '${node.id}'`)
        draft.nodes[node.id] = node
      }
      const target = draft.nodes[group.id]
      if (!target || target.type !== 'group') return
      for (const rootId of rootIds) {
        draft.nodes[rootId]!.parent = group.id
        target.children.push(rootId)
      }
    },
    { selectAfter: [group.id] },
  )
  return group.id
}

function brushGroupName(brush: BrushDef): string {
  if (brush.kind === 'scatter') return 'Scatter Brush'
  if (brush.kind === 'pattern') return 'Pattern Brush'
  return 'Art Brush'
}
