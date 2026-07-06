import { describe, expect, it } from 'vitest'
import { createLiveDefs } from './liveDefs'
import { createEditorStore } from './store'
import { cmdAddNode, cmdDeleteNodes, cmdSetStyle } from './commands'
import { createRectNode, rgba } from '../model/nodes'
import { defCount } from '../model/defs'
import type { GradientPaint } from '../model/types'

function grad(hue = 0): GradientPaint {
  return {
    type: 'gradient',
    gradientType: 'linear',
    stops: [
      { offset: 0, color: rgba(hue, 0, 0, 1) },
      { offset: 1, color: rgba(hue, 0, 0, 0) },
    ],
    transform: [100, 0, 0, 100, 0, 0],
  }
}

describe('live defs registry', () => {
  it('dedupes identical paints across nodes into ONE def', () => {
    const store = createEditorStore()
    const live = createLiveDefs()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const b = createRectNode({ x: 20, y: 0, w: 10, h: 10 })
    a.style.fill = grad()
    b.style.fill = grad()
    cmdAddNode(store, a)
    cmdAddNode(store, b)

    const reg = live.ensure(store.getState().document.nodes)
    expect(defCount(reg)).toBe(1)
    expect(live.defIdFor(grad())).toMatch(/^grad-/)
  })

  it('keeps ids STABLE across unrelated edits', () => {
    const store = createEditorStore()
    const live = createLiveDefs()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    a.style.fill = grad()
    const b = createRectNode({ x: 20, y: 0, w: 10, h: 10 })
    cmdAddNode(store, a)
    cmdAddNode(store, b)

    live.ensure(store.getState().document.nodes)
    const idBefore = live.defIdFor(grad())
    // Unrelated edit: recolor the OTHER node.
    cmdSetStyle(store, [b.id], 'Fill Color', (style) => {
      style.fill = { type: 'solid', color: rgba(1, 2, 3, 1) }
    })
    live.ensure(store.getState().document.nodes)
    expect(live.defIdFor(grad())).toBe(idBefore)
  })

  it("GC's a def when its LAST user is deleted (and not before)", () => {
    const store = createEditorStore()
    const live = createLiveDefs()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    const b = createRectNode({ x: 20, y: 0, w: 10, h: 10 })
    a.style.fill = grad()
    b.style.fill = grad()
    cmdAddNode(store, a)
    cmdAddNode(store, b)
    expect(defCount(live.ensure(store.getState().document.nodes))).toBe(1)

    cmdDeleteNodes(store, [a.id])
    expect(defCount(live.ensure(store.getState().document.nodes))).toBe(1) // b still uses it

    cmdDeleteNodes(store, [b.id])
    expect(defCount(live.ensure(store.getState().document.nodes))).toBe(0) // GONE
    expect(live.defIdFor(grad())).toBeNull()
  })

  it('releases when a paint is REPLACED, and distinct paints get distinct ids', () => {
    const store = createEditorStore()
    const live = createLiveDefs()
    const a = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
    a.style.fill = grad(10)
    a.style.stroke = grad(20) // second def on the SAME node (per-slot users)
    cmdAddNode(store, a)

    let reg = live.ensure(store.getState().document.nodes)
    expect(defCount(reg)).toBe(2)
    expect(live.defIdFor(grad(10))).not.toBe(live.defIdFor(grad(20)))

    cmdSetStyle(store, [a.id], 'Fill Color', (style) => {
      style.fill = { type: 'solid', color: rgba(0, 0, 0, 1) }
    })
    reg = live.ensure(store.getState().document.nodes)
    expect(defCount(reg)).toBe(1) // fill def released, stroke def kept
    expect(live.defIdFor(grad(10))).toBeNull()
    expect(live.defIdFor(grad(20))).not.toBeNull()
  })
})
