import { describe, expect, it } from 'vitest'
import { addNode, createDocument } from './document'
import {
  createEllipseNode,
  createGroupNode,
  createPathNode,
  createRectNode,
  convertToPath,
} from './nodes'
import { documentFromJSON, documentToJSON, documentToSVG } from './serialize'
import { ellipseToPath } from '../geometry/shapes'
import { compose, rotateMat, translate } from '../geometry/matrix'
import type { GradientPaint } from './types'

function buildTestDocument() {
  const doc = createDocument({ name: 'RoundTrip' })
  const group = createGroupNode({ transform: translate(50, 60) })
  const rect = createRectNode(
    { x: 0, y: 0, w: 120, h: 80, rx: 8 },
    { transform: compose(translate(10, 20), rotateMat(0.25)) },
  )
  const ellipse = createEllipseNode({ cx: 0, cy: 0, rx: 40, ry: 25 })
  const path = createPathNode(ellipseToPath(0, 0, 30, 30))
  addNode(doc, group)
  addNode(doc, rect, group.id)
  addNode(doc, ellipse, group.id)
  addNode(doc, path)
  return { doc, group, rect, ellipse, path }
}

describe('document <-> JSON round-trip', () => {
  it('preserves node, subpath, and anchor ids EXACTLY, plus all geometry', () => {
    const { doc } = buildTestDocument()
    const restored = documentFromJSON(documentToJSON(doc))
    // Full deep equality covers ids, transforms, params, styles, artboards.
    expect(restored).toEqual(doc)
  })

  it('preserves subpath/anchor ids through a convert-to-path round-trip', () => {
    const { doc, rect } = buildTestDocument()
    const asPath = convertToPath(rect)
    doc.nodes[rect.id] = asPath
    const restored = documentFromJSON(documentToJSON(doc))
    const restoredPath = restored.nodes[rect.id]!
    if (restoredPath.type !== 'path') throw new Error('expected path node')
    expect(restoredPath.subpaths.map((sp) => sp.id)).toEqual(asPath.subpaths.map((sp) => sp.id))
    expect(restoredPath.subpaths[0]!.anchors.map((a) => a.id)).toEqual(
      asPath.subpaths[0]!.anchors.map((a) => a.id),
    )
    expect(restoredPath.transform).toEqual(rect.transform)
  })

  it('rejects malformed documents instead of returning half-valid state', () => {
    expect(() => documentFromJSON('42')).toThrow()
    expect(() => documentFromJSON('{}')).toThrow()
    const { doc } = buildTestDocument()
    const broken = JSON.parse(documentToJSON(doc)) as {
      nodes: Record<string, { parent: string | null }>
      root: string
    }
    // Desync a child's parent pointer.
    const someChildId = Object.keys(broken.nodes).find((id) => id !== broken.root)!
    broken.nodes[someChildId]!.parent = 'bogus'
    expect(() => documentFromJSON(JSON.stringify(broken))).toThrow()
  })
})

describe('document -> SVG (model-emitted)', () => {
  it('emits paths and nested groups with transforms, no DOM involved', () => {
    const { doc, group, rect } = buildTestDocument()
    const svg = documentToSVG(doc)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain(`viewBox="0 0 1024 768"`)
    expect(svg).toContain(`<g id="${group.id}" transform="matrix(1,0,0,1,50,60)">`)
    expect(svg).toContain(`<path id="${rect.id}"`)
    expect(svg).toContain('fill="rgb(200,200,200)"')
    expect(svg).toContain('stroke="rgb(30,30,30)"')
  })

  it('skips hidden nodes and honors opacity', () => {
    const doc = createDocument()
    const shown = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { opacity: 0.5 })
    const hidden = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { hidden: true })
    addNode(doc, shown)
    addNode(doc, hidden)
    const svg = documentToSVG(doc)
    expect(svg).toContain(`id="${shown.id}"`)
    expect(svg).toContain('opacity="0.5"')
    expect(svg).not.toContain(`id="${hidden.id}"`)
  })

  it('routes gradient paints through the defs registry', () => {
    const doc = createDocument()
    const gradient: GradientPaint = {
      type: 'gradient',
      gradientType: 'linear',
      stops: [
        { offset: 0, color: { r: 255, g: 0, b: 0, a: 1 } },
        { offset: 1, color: { r: 0, g: 0, b: 255, a: 1 } },
      ],
      transform: [1, 0, 0, 1, 0, 0],
    }
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const b = createRectNode({ x: 20, y: 0, w: 10, h: 10 })
    a.style.fill = gradient
    b.style.fill = JSON.parse(JSON.stringify(gradient)) as GradientPaint
    addNode(doc, a)
    addNode(doc, b)
    const svg = documentToSVG(doc)
    // Identical paints dedupe to ONE def, referenced twice.
    expect(svg.match(/<linearGradient/g)).toHaveLength(1)
    expect(svg.match(/url\(#grad-1\)/g)).toHaveLength(2)
    expect(svg).toContain('stop-color="rgb(255,0,0)"')
  })
})
