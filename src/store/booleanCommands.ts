/**
 * Boolean commands: Pathfinder (Unite / Minus Front / Intersect / Exclude /
 * Divide / Trim / Merge), Outline Stroke, Knife, Eraser, and the Shape
 * Builder apply step. All heavy clipping math runs BEFORE applyCommand (pure
 * reads of the current document); the recipe only splices nodes — so every
 * command is one undo step with selection restored.
 *
 * Result placement honors the POSITIONING RULE: doc-space result regions are
 * mapped into the target parent's local space, rebased to their bbox min, and
 * the node transform carries the placement. Results use fillRule 'evenodd'
 * (matches how nodeRegionsInDoc composes subpaths, so holes always render).
 */

import type { Vec2 } from '../geometry/vec2'
import {
  difference,
  intersection,
  pointInRegions,
  union,
  xor,
  type Regions,
} from '../geometry/boolean'
import type { Document, GroupNode, NodeId, PathNode, SceneNode, Style } from '../model/types'
import { addNode, getWorldTransform, removeNode } from '../model/document'
import { cloneStyle, createGroupNode, createPathNode, toSubPaths } from '../model/nodes'
import {
  buildFaces,
  dropSlivers,
  nodeRegionsInDoc,
  rebaseRegions,
  regionsBBoxMin,
  regionsToParentSpace,
  regionsToSubPaths,
  trimOperands,
  type ArrangementOperand,
  type Face,
} from '../model/booleanOps'
import { outlineStroke } from '../model/strokeOutline'
import { createAnchor, createSubPath, rdpSimplify } from '../model/pathOps'
import { applyToPoint, translate } from '../geometry/matrix'
import type { EditorStoreApi } from './store'

export type PathfinderOp =
  | 'unite'
  | 'minusFront'
  | 'intersect'
  | 'exclude'
  | 'divide'
  | 'trim'
  | 'merge'

// ---------------------------------------------------------------------------
// Operand collection (paint order matters)
// ---------------------------------------------------------------------------

/** DFS paint-order index per node id (bottom of the stack = lowest). */
function paintOrder(doc: Document): Map<NodeId, number> {
  const order = new Map<NodeId, number>()
  let i = 0
  const visit = (id: NodeId): void => {
    order.set(id, i++)
    const node = doc.nodes[id]
    if (node?.type === 'group') for (const child of node.children) visit(child)
  }
  visit(doc.root)
  return order
}

interface Operand {
  id: NodeId
  regions: Regions
  style: Style
}

/**
 * Resolve `ids` (recursing groups) to unlocked visible leaves in paint order
 * (BOTTOM first). No geometry filtering — callers decide what counts.
 */
export function collectLeaves(doc: Document, ids: NodeId[]): NodeId[] {
  const seen = new Set<NodeId>()
  const leaves: NodeId[] = []
  const visit = (id: NodeId): void => {
    if (seen.has(id) || id === doc.root) return
    seen.add(id)
    const node = doc.nodes[id]
    if (!node || node.locked || node.hidden) return
    if (node.type === 'group') {
      for (const child of node.children) visit(child)
      return
    }
    if (node.type === 'text') return
    leaves.push(id)
  }
  for (const id of ids) visit(id)
  const order = paintOrder(doc)
  leaves.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  return leaves
}

/**
 * Leaves with a usable FILL REGION (boolean operands), bottom first.
 * Open hairlines and other zero-area leaves are dropped.
 */
export function collectOperands(doc: Document, ids: NodeId[]): Operand[] {
  const operands: Operand[] = []
  for (const id of collectLeaves(doc, ids)) {
    const regions = nodeRegionsInDoc(doc.nodes, id)
    if (regions.length > 0) {
      operands.push({ id, regions, style: cloneStyle(doc.nodes[id]!.style) })
    }
  }
  return operands
}

// ---------------------------------------------------------------------------
// Result node construction
// ---------------------------------------------------------------------------

/** Build a PathNode from DOC-space regions, placed in `parentId`'s space. */
function resultNode(
  doc: Document,
  parentId: NodeId,
  regions: Regions,
  style: Style,
  name: string,
): PathNode {
  const local = regionsToParentSpace(doc.nodes, parentId, doc.root, regions)
  const origin = regionsBBoxMin(local)
  const node = createPathNode(regionsToSubPaths(rebaseRegions(local, origin)), {
    name,
    transform: translate(origin.x, origin.y),
    style,
  })
  node.style.fillRule = 'evenodd'
  return node
}

/** Parent + child index of a node (root children fallback). */
function placementOf(doc: Document, id: NodeId): { parentId: NodeId; index: number } {
  const node = doc.nodes[id]
  const parentId = node?.parent ?? doc.root
  const parent = doc.nodes[parentId] as GroupNode | undefined
  const index = parent ? parent.children.indexOf(id) : 0
  return { parentId, index: Math.max(0, index) }
}

// ---------------------------------------------------------------------------
// Pathfinder
// ---------------------------------------------------------------------------

const OP_LABEL: Record<PathfinderOp, string> = {
  unite: 'Unite',
  minusFront: 'Minus Front',
  intersect: 'Intersect',
  exclude: 'Exclude',
  divide: 'Divide',
  trim: 'Trim',
  merge: 'Merge',
}

/**
 * Run a Pathfinder operation over the selection. Returns the created node
 * ids (result path, or the group for divide/trim/merge), or [] if the
 * operation produced nothing (in which case the document is untouched).
 */
export function cmdPathfinder(store: EditorStoreApi, op: PathfinderOp, ids: NodeId[]): NodeId[] {
  const doc = store.getState().document
  const operands = collectOperands(doc, ids)
  if (operands.length < 2) return []

  const bottom = operands[0]!
  const top = operands[operands.length - 1]!
  const topFirst = [...operands].reverse()

  const consumed = operands.map((o) => o.id)
  let created: SceneNode[] = []
  let placeAt = placementOf(doc, top.id)

  if (op === 'unite' || op === 'minusFront' || op === 'intersect' || op === 'exclude') {
    let regions: Regions
    let style: Style
    switch (op) {
      case 'unite':
        regions = union(bottom.regions, ...operands.slice(1).map((o) => o.regions))
        style = top.style
        break
      case 'minusFront':
        regions = difference(bottom.regions, ...operands.slice(1).map((o) => o.regions))
        style = bottom.style
        placeAt = placementOf(doc, bottom.id)
        break
      case 'intersect':
        regions = intersection(bottom.regions, ...operands.slice(1).map((o) => o.regions))
        style = top.style
        break
      case 'exclude':
        regions = xor(bottom.regions, ...operands.slice(1).map((o) => o.regions))
        style = top.style
        break
    }
    regions = dropSlivers(regions)
    if (regions.length === 0) return []
    created = [resultNode(doc, placeAt.parentId, regions, style, OP_LABEL[op])]
  } else {
    // Divide / Trim / Merge: multiple result paths, grouped.
    const arrangement: ArrangementOperand[] = topFirst.map((o) => ({
      id: o.id,
      regions: o.regions,
      style: o.style,
    }))
    const styleOf = new Map(operands.map((o) => [o.id, o.style]))
    const pieces: Array<{ regions: Regions; style: Style }> = []

    if (op === 'divide') {
      for (const face of buildFaces(arrangement)) {
        pieces.push({ regions: [face.region], style: cloneStyle(styleOf.get(face.sourceId)!) })
      }
    } else {
      // trim & merge: visible part of each operand, strokes removed (AI).
      let visible = trimOperands(arrangement).map((v) => ({
        regions: v.regions,
        style: (() => {
          const s = cloneStyle(styleOf.get(v.id)!)
          s.stroke = null
          delete s.widthProfile
          return s
        })(),
      }))
      if (op === 'merge') {
        // Unite adjacent pieces with an identical fill.
        const byFill = new Map<string, { regions: Regions; style: Style }>()
        for (const v of visible) {
          const key = JSON.stringify(v.style.fill)
          const existing = byFill.get(key)
          if (existing) existing.regions = union(existing.regions, v.regions)
          else byFill.set(key, v)
        }
        visible = [...byFill.values()]
      }
      pieces.push(...visible)
    }
    if (pieces.length === 0) return []
    const group = createGroupNode({ name: OP_LABEL[op] })
    const children = pieces.map((p, i) =>
      resultNode(doc, placeAt.parentId, p.regions, p.style, `${OP_LABEL[op]} ${i + 1}`),
    )
    created = [group, ...children]
    // Children are re-parented into the group inside the recipe.
    store.getState().applyCommand(
      OP_LABEL[op],
      (draft) => {
        for (const id of consumed) if (draft.nodes[id]) removeNode(draft, id)
        addNode(draft, group, placeAt.parentId, Math.min(placeAt.index, childCount(draft, placeAt.parentId)))
        for (const child of children) addNode(draft, child, group.id)
      },
      { selectAfter: [group.id] },
    )
    return [group.id]
  }

  const result = created[0]!
  store.getState().applyCommand(
    OP_LABEL[op],
    (draft) => {
      for (const id of consumed) if (draft.nodes[id]) removeNode(draft, id)
      addNode(draft, result, placeAt.parentId, Math.min(placeAt.index, childCount(draft, placeAt.parentId)))
    },
    { selectAfter: [result.id] },
  )
  return [result.id]
}

function childCount(doc: Document, parentId: NodeId): number {
  const parent = doc.nodes[parentId]
  return parent?.type === 'group' ? parent.children.length : 0
}

// ---------------------------------------------------------------------------
// Outline Stroke
// ---------------------------------------------------------------------------

/**
 * Outline Stroke: each selected stroked leaf gains a sibling path that IS its
 * stroke geometry (filled with the stroke paint); the source keeps only its
 * fill (or is removed when it had none). Returns the new outline node ids.
 */
export function cmdOutlineStroke(store: EditorStoreApi, ids: NodeId[]): NodeId[] {
  const doc = store.getState().document
  // collectLeaves, NOT collectOperands: open strokes (lines, pen paths) have
  // no fill region but are exactly what outlining is for.
  const results: Array<{ oldId: NodeId; node: PathNode }> = []
  for (const leafId of collectLeaves(doc, ids)) {
    const source = doc.nodes[leafId]!
    if (source.type === 'group' || source.type === 'text' || source.style.stroke === null) continue
    const local = outlineStroke(toSubPaths(source), source.style)
    if (!local) continue
    // Stroke region in DOC space = local outline through the world transform.
    const world = getWorldTransform(doc.nodes, leafId)
    const outlineDoc: Regions = local.map((region) =>
      region.map((ring) => ring.map((p) => applyToPoint(world, p))),
    )
    const style = cloneStyle(source.style)
    style.fill = style.stroke
    style.stroke = null
    delete style.widthProfile
    const placeParent = source.parent ?? doc.root
    const node = resultNode(doc, placeParent, outlineDoc, style, 'Outline')
    results.push({ oldId: leafId, node })
  }
  if (results.length === 0) return []
  store.getState().applyCommand(
    'Outline Stroke',
    (draft) => {
      for (const r of results) {
        const source = draft.nodes[r.oldId]
        if (!source) continue
        const { parentId, index } = placementOf(draft, r.oldId)
        if (source.style.fill === null) {
          removeNode(draft, r.oldId)
        } else {
          // Keep the filled body; just drop its stroke (now outlined above).
          source.style.stroke = null
          delete source.style.widthProfile
        }
        addNode(draft, r.node, parentId, Math.min(index + 1, childCount(draft, parentId)))
      }
    },
    { selectAfter: results.map((r) => r.node.id) },
  )
  return results.map((r) => r.node.id)
}

// ---------------------------------------------------------------------------
// Knife / Eraser
// ---------------------------------------------------------------------------

/** Blade region for a freehand trail (doc space): a thin/blunt stroke outline. */
export function bladeRegions(trail: Vec2[], width: number): Regions {
  const simplified = rdpSimplify(trail, 0.4)
  if (simplified.length < 2) return []
  const sp = createSubPath(simplified.map((p) => createAnchor(p)), false)
  const style: Style = {
    fill: null,
    stroke: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } },
    strokeWidth: width,
    strokeCap: 'butt',
    strokeJoin: 'round',
    strokeDash: [],
    fillRule: 'nonzero',
  }
  return outlineStroke([sp], style) ?? []
}

const KNIFE_WIDTH = 0.15

/**
 * Freehand knife cut: every intersected target splits into SEPARATE closed
 * paths (one node per disjoint piece). Targets = `ids` if given, else all
 * cuttable leaves. Returns new node ids.
 */
export function cmdKnife(store: EditorStoreApi, trail: Vec2[], ids?: NodeId[]): NodeId[] {
  const doc = store.getState().document
  const blade = bladeRegions(trail, KNIFE_WIDTH)
  if (blade.length === 0) return []
  const targets = collectOperands(
    doc,
    ids && ids.length > 0 ? ids : (doc.nodes[doc.root] as GroupNode).children,
  )
  const jobs: Array<{ oldId: NodeId; nodes: PathNode[] }> = []
  for (const target of targets) {
    if (dropSlivers(intersection(target.regions, blade)).length === 0) continue
    const pieces = dropSlivers(difference(target.regions, blade))
    if (pieces.length < 2) continue // no actual split
    const { parentId } = placementOf(doc, target.id)
    const nodes = pieces.map((region, i) =>
      resultNode(doc, parentId, [region], cloneStyle(target.style), `Piece ${i + 1}`),
    )
    jobs.push({ oldId: target.id, nodes })
  }
  if (jobs.length === 0) return []
  const createdIds = jobs.flatMap((j) => j.nodes.map((n) => n.id))
  store.getState().applyCommand(
    'Knife',
    (draft) => {
      for (const job of jobs) {
        if (!draft.nodes[job.oldId]) continue
        const { parentId, index } = placementOf(draft, job.oldId)
        removeNode(draft, job.oldId)
        job.nodes.forEach((n, i) =>
          addNode(draft, n, parentId, Math.min(index + i, childCount(draft, parentId))),
        )
      }
    },
    { selectAfter: createdIds },
  )
  return createdIds
}

/**
 * Eraser: subtract the eraser blob from every target it touches. Nodes erased
 * to nothing are deleted; survivors are rebuilt in place (same id kept via
 * node replacement preserving z). Returns affected node ids.
 */
export function cmdErase(
  store: EditorStoreApi,
  trail: Vec2[],
  radius: number,
  ids?: NodeId[],
): NodeId[] {
  const doc = store.getState().document
  const blob = bladeRegions(trail.length > 1 ? trail : [...trail, ...trail], radius * 2)
  if (blob.length === 0) return []
  const targets = collectOperands(
    doc,
    ids && ids.length > 0 ? ids : (doc.nodes[doc.root] as GroupNode).children,
  )
  const jobs: Array<{ oldId: NodeId; replacement: PathNode | null }> = []
  for (const target of targets) {
    if (dropSlivers(intersection(target.regions, blob)).length === 0) continue
    const remaining = dropSlivers(difference(target.regions, blob))
    if (remaining.length === 0) {
      jobs.push({ oldId: target.id, replacement: null })
    } else {
      const { parentId } = placementOf(doc, target.id)
      jobs.push({
        oldId: target.id,
        replacement: resultNode(doc, parentId, remaining, cloneStyle(target.style), 'Erased'),
      })
    }
  }
  if (jobs.length === 0) return []
  const survivors = jobs.filter((j) => j.replacement).map((j) => j.replacement!.id)
  store.getState().applyCommand(
    'Erase',
    (draft) => {
      for (const job of jobs) {
        if (!draft.nodes[job.oldId]) continue
        const { parentId, index } = placementOf(draft, job.oldId)
        removeNode(draft, job.oldId)
        if (job.replacement) {
          addNode(draft, job.replacement, parentId, Math.min(index, childCount(draft, parentId)))
        }
      }
    },
    { selectAfter: survivors },
  )
  return survivors
}

// ---------------------------------------------------------------------------
// Shape Builder apply
// ---------------------------------------------------------------------------

/**
 * Apply a Shape Builder gesture: `picked` faces merge into one path (or are
 * deleted with alt); every remaining face survives as its own path. The
 * source nodes are consumed. One undo step.
 */
export function cmdShapeBuilder(
  store: EditorStoreApi,
  sourceIds: NodeId[],
  faces: Face[],
  picked: number[],
  mode: 'merge' | 'delete',
): NodeId[] {
  const doc = store.getState().document
  if (faces.length === 0 || picked.length === 0) return []
  const operands = collectOperands(doc, sourceIds)
  if (operands.length === 0) return []
  const styleOf = new Map(operands.map((o) => [o.id, o.style]))
  const top = operands[operands.length - 1]!
  const placeAt = placementOf(doc, top.id)

  const pickedSet = new Set(picked)
  const created: PathNode[] = []
  if (mode === 'merge') {
    const regions = union(
      [],
      ...picked.map((i): Regions => (faces[i] ? [faces[i].region] : [])),
    )
    if (regions.length > 0) {
      const first = faces[picked[0]!]
      const style = cloneStyle(styleOf.get(first!.sourceId) ?? top.style)
      created.push(resultNode(doc, placeAt.parentId, regions, style, 'Merged'))
    }
  }
  faces.forEach((face, i) => {
    if (pickedSet.has(i)) return
    const style = cloneStyle(styleOf.get(face.sourceId) ?? top.style)
    created.push(resultNode(doc, placeAt.parentId, [face.region], style, `Region ${i + 1}`))
  })
  if (created.length === 0 && mode === 'merge') return []

  const consumed = operands.map((o) => o.id)
  store.getState().applyCommand(
    mode === 'merge' ? 'Shape Builder' : 'Shape Builder Delete',
    (draft) => {
      for (const id of consumed) if (draft.nodes[id]) removeNode(draft, id)
      created.forEach((n, i) =>
        addNode(draft, n, placeAt.parentId, Math.min(placeAt.index + i, childCount(draft, placeAt.parentId))),
      )
    },
    { selectAfter: mode === 'merge' && created[0] ? [created[0].id] : [] },
  )
  return created.map((n) => n.id)
}

/** Face under a doc-space point (topmost-listed wins). */
export function faceAtPoint(faces: Face[], p: Vec2): number {
  for (let i = 0; i < faces.length; i++) {
    if (pointInRegions([faces[i]!.region], p)) return i
  }
  return -1
}
