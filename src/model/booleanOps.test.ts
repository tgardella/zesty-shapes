import { describe, expect, it } from 'vitest'
import { pointInRegions, regionsArea } from '../geometry/boolean'
import { compose, rotateMat, translate } from '../geometry/matrix'
import { createEllipseNode, createRectNode, defaultStyle } from './nodes'
import {
  buildFaces,
  flattenSubPath,
  nodeRegionsInDoc,
  regionsToSubPaths,
  trimOperands,
} from './booleanOps'
import { createAnchor, createSubPath } from './pathOps'
import type { NodeId, SceneNode } from './types'

function nodesOf(...nodes: SceneNode[]): Record<NodeId, SceneNode> {
  return Object.fromEntries(nodes.map((n) => [n.id, n]))
}

describe('nodeRegionsInDoc', () => {
  it('applies the WORLD transform (params local, placement in transform)', () => {
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { transform: translate(100, 50) })
    const regions = nodeRegionsInDoc(nodesOf(rect), rect.id)
    expect(regionsArea(regions)).toBeCloseTo(100)
    expect(pointInRegions(regions, { x: 105, y: 55 })).toBe(true)
    expect(pointInRegions(regions, { x: 5, y: 5 })).toBe(false)
  })

  it('flattens curves: an ellipse approximates its area', () => {
    const ell = createEllipseNode({ cx: 0, cy: 0, rx: 20, ry: 10 })
    const regions = nodeRegionsInDoc(nodesOf(ell), ell.id)
    expect(regionsArea(regions)).toBeCloseTo(Math.PI * 20 * 10, -1) // within ~5
  })

  it('a rotated rect still covers its rotated footprint', () => {
    const rect = createRectNode(
      { x: -10, y: -10, w: 20, h: 20 },
      { transform: compose(translate(50, 50), rotateMat(Math.PI / 4)) },
    )
    const regions = nodeRegionsInDoc(nodesOf(rect), rect.id)
    expect(regionsArea(regions)).toBeCloseTo(400, 5)
    expect(pointInRegions(regions, { x: 50, y: 50 })).toBe(true)
    // The unrotated corner (60,60) is OUTSIDE the diamond.
    expect(pointInRegions(regions, { x: 59, y: 59 })).toBe(false)
  })

  it('two subpaths XOR into a donut', () => {
    const outer = flattenSubPath(
      createSubPath(
        [
          createAnchor({ x: 0, y: 0 }),
          createAnchor({ x: 30, y: 0 }),
          createAnchor({ x: 30, y: 30 }),
          createAnchor({ x: 0, y: 30 }),
        ],
        true,
      ),
    )
    expect(outer).toHaveLength(4) // straight segments stay unflattened
  })
})

describe('regionsToSubPaths', () => {
  it('emits closed corner subpaths, holes as separate rings', () => {
    const subpaths = regionsToSubPaths([
      [
        [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 30 },
          { x: 0, y: 30 },
        ],
        [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
          { x: 20, y: 20 },
          { x: 10, y: 20 },
        ],
      ],
    ])
    expect(subpaths).toHaveLength(2)
    expect(subpaths.every((sp) => sp.closed)).toBe(true)
    expect(subpaths.every((sp) => sp.anchors.every((a) => a.type === 'corner'))).toBe(true)
    expect(subpaths.every((sp) => sp.anchors.every((a) => a.handleIn === null))).toBe(true)
  })
})

describe('arrangement (Divide / Trim)', () => {
  const style = defaultStyle()
  const A = createRectNode({ x: 0, y: 0, w: 10, h: 10 }) // bottom
  const B = createRectNode({ x: 5, y: 5, w: 10, h: 10 }) // top
  const nodes = nodesOf(A, B)
  const opTop = { id: B.id, regions: nodeRegionsInDoc(nodes, B.id), style }
  const opBottom = { id: A.id, regions: nodeRegionsInDoc(nodes, A.id), style }

  it('buildFaces yields the three atomic regions with topmost ownership', () => {
    const faces = buildFaces([opTop, opBottom])
    expect(faces).toHaveLength(3)
    const total = faces.reduce((sum, f) => sum + regionsArea([f.region]), 0)
    expect(total).toBeCloseTo(175)
    // The overlap face belongs to the TOP operand.
    const overlap = faces.find((f) => pointInRegions([f.region], { x: 7.5, y: 7.5 }))!
    expect(overlap.sourceId).toBe(B.id)
    expect(regionsArea([overlap.region])).toBeCloseTo(25)
    // The A-only face belongs to A.
    const aOnly = faces.find((f) => pointInRegions([f.region], { x: 2, y: 2 }))!
    expect(aOnly.sourceId).toBe(A.id)
    expect(regionsArea([aOnly.region])).toBeCloseTo(75)
  })

  it('trimOperands: the top keeps everything, the bottom loses the overlap', () => {
    const visible = trimOperands([opTop, opBottom])
    expect(visible).toHaveLength(2)
    const top = visible.find((v) => v.id === B.id)!
    const bottom = visible.find((v) => v.id === A.id)!
    expect(regionsArea(top.regions)).toBeCloseTo(100)
    expect(regionsArea(bottom.regions)).toBeCloseTo(75)
  })
})
