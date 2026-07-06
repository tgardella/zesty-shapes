import { describe, expect, it } from 'vitest'
import { cloneSubtrees, orderedSubtreeRoots } from './clone'
import { addNode, createDocument } from './document'
import { convertToPath, createGroupNode, createRectNode } from './nodes'
import type { GroupNode, PathNode } from './types'

function buildDoc() {
  const doc = createDocument()
  const group = createGroupNode()
  const inner = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
  const solo = createRectNode({ x: 0, y: 0, w: 5, h: 5 })
  addNode(doc, group)
  addNode(doc, inner, group.id)
  addNode(doc, solo)
  return { doc, group, inner, solo }
}

describe('cloneSubtrees', () => {
  it('regenerates every node id and rewires parent/children', () => {
    const { doc, group, inner } = buildDoc()
    const clones = cloneSubtrees(doc.nodes, [group.id])
    expect(clones.rootIds).toHaveLength(1)
    expect(clones.nodes).toHaveLength(2)

    const cloneRoot = clones.nodes.find((n) => n.id === clones.rootIds[0])! as GroupNode
    const cloneChild = clones.nodes.find((n) => n.id !== clones.rootIds[0])!
    expect(cloneRoot.id).not.toBe(group.id)
    expect(cloneChild.id).not.toBe(inner.id)
    expect(cloneRoot.parent).toBeNull() // assigned at insert
    expect(cloneChild.parent).toBe(cloneRoot.id)
    expect(cloneRoot.children).toEqual([cloneChild.id])
  })

  it('regenerates subpath and anchor ids for PathNodes', () => {
    const { doc } = buildDoc()
    const path = convertToPath(createRectNode({ x: 0, y: 0, w: 20, h: 20, rx: 4 }))
    addNode(doc, path)
    const clones = cloneSubtrees(doc.nodes, [path.id])
    const clonePath = clones.nodes[0] as PathNode
    expect(clonePath.subpaths[0]!.id).not.toBe(path.subpaths[0]!.id)
    const originalAnchorIds = new Set(path.subpaths[0]!.anchors.map((a) => a.id))
    for (const anchor of clonePath.subpaths[0]!.anchors) {
      expect(originalAnchorIds.has(anchor.id)).toBe(false)
    }
    // Geometry itself is identical.
    expect(clonePath.subpaths[0]!.anchors.map((a) => a.point)).toEqual(
      path.subpaths[0]!.anchors.map((a) => a.point),
    )
  })

  it('clones are deep copies — mutating one never touches the source', () => {
    const { doc, solo } = buildDoc()
    const clones = cloneSubtrees(doc.nodes, [solo.id])
    const clone = clones.nodes[0]!
    clone.transform[4] = 999
    expect(doc.nodes[solo.id]!.transform[4]).not.toBe(999)
  })
})

describe('orderedSubtreeRoots', () => {
  it('drops ids nested under another selected id and orders by z-order', () => {
    const { doc, group, inner, solo } = buildDoc()
    // inner is inside group: selecting both collapses to the group root.
    expect(orderedSubtreeRoots(doc, [inner.id, group.id])).toEqual([group.id])
    // z-order (group added before solo) wins over the input order.
    expect(orderedSubtreeRoots(doc, [solo.id, group.id])).toEqual([group.id, solo.id])
    expect(orderedSubtreeRoots(doc, [])).toEqual([])
    expect(orderedSubtreeRoots(doc, ['missing'])).toEqual([])
  })
})
