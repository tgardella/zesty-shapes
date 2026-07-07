import { describe, expect, it } from 'vitest'
import { createEditorStore } from './store'
import { cmdAddNode, cmdGroupNodes } from './commands'
import { canSelectSame, paintsEqual, selectSame } from './selectSame'
import { createRectNode, rgba } from '../model/nodes'
import type { EditorStoreApi } from './store'

const RED = { type: 'solid' as const, color: rgba(255, 0, 0, 1) }
const BLUE = { type: 'solid' as const, color: rgba(0, 0, 255, 1) }

function rect(store: EditorStoreApi, fill: typeof RED, strokeW = 1, opacity = 1): string {
  const n = createRectNode({ x: 0, y: 0, w: 10, h: 10 })
  n.style.fill = { ...fill }
  n.style.stroke = { type: 'solid', color: rgba(0, 0, 0, 1) }
  n.style.strokeWidth = strokeW
  n.opacity = opacity
  cmdAddNode(store, n)
  return n.id
}

describe('paintsEqual', () => {
  it('matches equal solids and rejects different ones / null', () => {
    expect(paintsEqual({ ...RED }, { ...RED })).toBe(true)
    expect(paintsEqual({ ...RED }, { ...BLUE })).toBe(false)
    expect(paintsEqual(null, null)).toBe(true)
    expect(paintsEqual({ ...RED }, null)).toBe(false)
  })

  it('compares gradients by type and stops', () => {
    const g = (t: 'linear' | 'radial') =>
      ({
        type: 'gradient' as const,
        gradientType: t,
        stops: [
          { offset: 0, color: rgba(0, 0, 0, 1) },
          { offset: 1, color: rgba(255, 255, 255, 1) },
        ],
        transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
      })
    expect(paintsEqual(g('linear'), g('linear'))).toBe(true)
    expect(paintsEqual(g('linear'), g('radial'))).toBe(false)
  })
})

describe('selectSame', () => {
  it('selects every object with the same fill as the seed', () => {
    const store = createEditorStore()
    const a = rect(store, RED)
    const b = rect(store, BLUE)
    const c = rect(store, RED)
    store.getState().setSelection([a])

    const matched = selectSame(store, 'fill')
    expect(new Set(matched)).toEqual(new Set([a, c]))
    expect(new Set(store.getState().selection)).toEqual(new Set([a, c]))
    expect(matched).not.toContain(b)
  })

  it('selects by stroke weight', () => {
    const store = createEditorStore()
    const a = rect(store, RED, 4)
    rect(store, BLUE, 2)
    const c = rect(store, BLUE, 4)
    store.getState().setSelection([a])

    expect(new Set(selectSame(store, 'strokeWidth'))).toEqual(new Set([a, c]))
  })

  it('selects by opacity', () => {
    const store = createEditorStore()
    const a = rect(store, RED, 1, 0.5)
    rect(store, BLUE, 1, 1)
    const c = rect(store, BLUE, 1, 0.5)
    store.getState().setSelection([a])

    expect(new Set(selectSame(store, 'opacity'))).toEqual(new Set([a, c]))
  })

  it('finds the seed inside a group and matches across nesting', () => {
    const store = createEditorStore()
    const a = rect(store, RED)
    const b = rect(store, RED)
    const g = cmdGroupNodes(store, [a, b])!
    const c = rect(store, RED)
    store.getState().setSelection([g])

    // Seed = first leaf of the group; all three reds match.
    expect(new Set(selectSame(store, 'fill'))).toEqual(new Set([a, b, c]))
  })

  it('is a no-op with an empty selection', () => {
    const store = createEditorStore()
    rect(store, RED)
    store.getState().clearSelection()
    expect(canSelectSame(store, [])).toBe(false)
    expect(selectSame(store, 'fill')).toEqual([])
  })

  it('does not create an undo step (pure selection change)', () => {
    const store = createEditorStore()
    const a = rect(store, RED)
    rect(store, RED)
    store.getState().setSelection([a])
    const undoBefore = store.getState().history.undoStack.length
    selectSame(store, 'fill')
    expect(store.getState().history.undoStack.length).toBe(undoBefore)
  })
})
