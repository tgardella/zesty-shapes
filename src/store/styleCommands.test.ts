import { describe, expect, it } from 'vitest'
import {
  cmdAddNode,
  cmdApplyAppearance,
  cmdSetStyle,
  cmdSwapFillStroke,
  sampleAppearance,
  stylableLeafIds,
} from './commands'
import { createEditorStore } from './store'
import { addNode } from '../model/document'
import { createGroupNode, createRectNode, rgba } from '../model/nodes'
import { documentToSVG } from '../model/serialize'
import type { GradientPaint } from '../model/types'

const RED = rgba(255, 0, 0, 1)
const BLUE = rgba(0, 0, 255, 1)

function grad(): GradientPaint {
  return {
    type: 'gradient',
    gradientType: 'linear',
    stops: [
      { offset: 0, color: RED },
      { offset: 1, color: rgba(255, 0, 0, 0) },
    ],
    transform: [100, 0, 0, 100, 0, 0],
  }
}

describe('cmdSetStyle', () => {
  it('recurses groups to their leaves; locked leaves are skipped', () => {
    const store = createEditorStore()
    const group = createGroupNode()
    const inside = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const locked = createRectNode({ x: 20, y: 0, w: 10, h: 10 }, { locked: true })
    store.getState().applyCommand('Build', (doc) => {
      addNode(doc, group)
      addNode(doc, inside, group.id)
      addNode(doc, locked, group.id)
    })

    expect(
      stylableLeafIds(store.getState().document.nodes, [group.id], store.getState().document.root),
    ).toEqual([inside.id])

    cmdSetStyle(store, [group.id], 'Fill Color', (style) => {
      style.fill = { type: 'solid', color: BLUE }
    })
    const nodes = store.getState().document.nodes
    expect(nodes[inside.id]!.style.fill).toEqual({ type: 'solid', color: BLUE })
    expect(nodes[locked.id]!.style.fill).not.toEqual({ type: 'solid', color: BLUE })

    // One undo step restores it.
    store.getState().undo()
    expect(store.getState().document.nodes[inside.id]!.style.fill).not.toEqual({
      type: 'solid',
      color: BLUE,
    })
  })

  it('swap exchanges the paints only', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    rect.style.fill = { type: 'solid', color: RED }
    rect.style.stroke = { type: 'solid', color: BLUE }
    rect.style.strokeWidth = 4
    cmdAddNode(store, rect)
    cmdSwapFillStroke(store, [rect.id])
    const style = store.getState().document.nodes[rect.id]!.style
    expect(style.fill).toEqual({ type: 'solid', color: BLUE })
    expect(style.stroke).toEqual({ type: 'solid', color: RED })
    expect(style.strokeWidth).toBe(4) // width stays with the stroke slot
  })
})

describe('eyedropper appearance transfer', () => {
  it('applies style + opacity + blend to the selection in one undo step', () => {
    const store = createEditorStore()
    const source = createRectNode({ x: 0, y: 0, w: 10, h: 10 }, { opacity: 0.5 })
    source.style.fill = { type: 'solid', color: RED }
    source.style.strokeDash = [4, 2]
    const target = createRectNode({ x: 20, y: 0, w: 10, h: 10 })
    cmdAddNode(store, source)
    cmdAddNode(store, target)

    const appearance = sampleAppearance(store.getState().document.nodes[source.id]!)
    cmdApplyAppearance(store, [target.id], appearance)

    const after = store.getState().document.nodes[target.id]!
    expect(after.style.fill).toEqual({ type: 'solid', color: RED })
    expect(after.style.strokeDash).toEqual([4, 2])
    expect(after.opacity).toBe(0.5)
    // The applied style is a COPY — mutating the source later must not leak.
    expect(after.style).not.toBe(store.getState().document.nodes[source.id]!.style)

    store.getState().undo()
    expect(store.getState().document.nodes[target.id]!.opacity).toBe(1)
  })
})

describe('gradient export through the defs registry', () => {
  it('two users of an identical gradient share ONE def; deletion GCs it', () => {
    const store = createEditorStore()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const b = createRectNode({ x: 20, y: 0, w: 10, h: 10 })
    a.style.fill = grad()
    b.style.fill = grad()
    cmdAddNode(store, a)
    cmdAddNode(store, b)

    let svg = documentToSVG(store.getState().document)
    expect(svg.match(/<linearGradient/g)).toHaveLength(1)
    expect(svg).toContain('gradientUnits="userSpaceOnUse"')
    expect(svg.match(/url\(#grad-1\)/g)).toHaveLength(2) // both nodes reference it

    // Delete one user: the def survives for the other.
    store.getState().applyCommand('Delete', (doc) => {
      delete doc.nodes[a.id]
      const root = doc.nodes[doc.root]
      if (root && root.type === 'group') root.children = root.children.filter((c) => c !== a.id)
    })
    svg = documentToSVG(store.getState().document)
    expect(svg.match(/<linearGradient/g)).toHaveLength(1)

    // Delete the last user: the def is REMOVED from the export.
    store.getState().applyCommand('Delete', (doc) => {
      delete doc.nodes[b.id]
      const root = doc.nodes[doc.root]
      if (root && root.type === 'group') root.children = root.children.filter((c) => c !== b.id)
    })
    svg = documentToSVG(store.getState().document)
    expect(svg).not.toContain('<linearGradient')
    expect(svg).not.toContain('<defs>')
  })
})

describe('variable-width export', () => {
  it('emits the chunked approximation (fill path + per-chunk widths)', () => {
    const store = createEditorStore()
    const rect = createRectNode({ x: 0, y: 0, w: 100, h: 50 })
    rect.style.widthProfile = [
      { offset: 0, width: 1 },
      { offset: 1, width: 12 },
    ]
    cmdAddNode(store, rect)
    const svg = documentToSVG(store.getState().document)
    expect(svg).toContain('stroke-linecap="round"')
    const widths = [...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => parseFloat(m[1]!))
    expect(widths.length).toBeGreaterThan(8) // many chunks
    expect(Math.max(...widths)).toBeGreaterThan(10)
    expect(Math.min(...widths)).toBeLessThan(2)
    // The fill still exports as one normal path.
    expect(svg).toContain('stroke="none"')
  })
})
