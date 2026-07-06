/**
 * The LIVE defs registry: the on-canvas counterpart of the export-time
 * registry in model/serialize.ts. One persistent DefsRegistry is diff-synced
 * against the current node map, so:
 *  - identical gradient paints DEDUPE to one def,
 *  - def ids stay STABLE across unrelated edits (paints keep their id for as
 *    long as anyone uses them),
 *  - defs are GC'd the moment their last user (a node's fill or stroke slot)
 *    is deleted or repainted.
 *
 * Sync is memoized on the nodes-map reference (Immer gives a fresh reference
 * per document change), so every render-path caller can call ensure*()
 * idempotently without ordering concerns between <Defs> and NodeViews.
 */

import type { GradientPaint, NodeId, SceneNode } from '../model/types'
import {
  acquireDef,
  createDefsRegistry,
  paintKey,
  paintNeedsDef,
  releaseDef,
  type DefsRegistry,
} from '../model/defs'

export interface LiveDefs {
  /** Sync (memoized by nodes reference) and return the registry. */
  ensure(nodes: Record<NodeId, SceneNode>): DefsRegistry
  /** url(#...) id for a paint after ensure(); null when unregistered. */
  defIdFor(paint: GradientPaint): string | null
}

/** Paint slots that can hold a def-backed paint, with per-slot user ids. */
function* gradientSlots(
  node: SceneNode,
): Generator<{ userId: string; paint: GradientPaint }> {
  if (paintNeedsDef(node.style.fill)) yield { userId: `${node.id}/fill`, paint: node.style.fill }
  if (paintNeedsDef(node.style.stroke)) {
    yield { userId: `${node.id}/stroke`, paint: node.style.stroke }
  }
}

export function createLiveDefs(): LiveDefs {
  const reg = createDefsRegistry()
  let lastNodes: Record<NodeId, SceneNode> | null = null

  const sync = (nodes: Record<NodeId, SceneNode>): void => {
    // Desired state: userId -> paint key.
    const desired = new Map<string, GradientPaint>()
    for (const node of Object.values(nodes)) {
      for (const slot of gradientSlots(node)) desired.set(slot.userId, slot.paint)
    }
    // Release users that vanished or now point at a different paint. GC of
    // empty entries happens inside releaseDef.
    for (const entry of Object.values(reg.entries)) {
      for (const userId of Object.keys(entry.users)) {
        const want = desired.get(userId)
        if (!want || paintKey(want) !== entry.key) releaseDef(reg, entry.id, userId)
      }
    }
    // Acquire everything desired (idempotent for unchanged users).
    for (const [userId, paint] of desired) acquireDef(reg, paint, userId)
  }

  return {
    ensure(nodes) {
      if (nodes !== lastNodes) {
        sync(nodes)
        lastNodes = nodes
      }
      return reg
    },
    defIdFor(paint) {
      return reg.entries[paintKey(paint)]?.id ?? null
    },
  }
}

/** App-wide singleton used by the render path (tests create their own). */
export const liveDefs: LiveDefs = createLiveDefs()
