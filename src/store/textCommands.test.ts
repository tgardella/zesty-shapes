import { describe, expect, it } from 'vitest'
import { cmdAddNode } from './commands'
import { cmdConvertTextToOutlines, cmdSetTextAttrs, finishTextEdit } from './textCommands'
import { createEditorStore } from './store'
import { createTextNode } from '../model/nodes'
import { createAnchor, createSubPath } from '../model/pathOps'
import { documentToSVG } from '../model/serialize'
import type { PathNode, SubPath, TextNode } from '../model/types'

describe('text rendering/export', () => {
  it('exports laid-out tspans with per-char x positions', () => {
    const store = createEditorStore()
    const node = createTextNode(
      { text: 'Hi\nthere', fontSize: 20, leading: 1.5 },
      { transform: [1, 0, 0, 1, 100, 50] },
    )
    cmdAddNode(store, node)
    const svg = documentToSVG(store.getState().document)
    expect(svg).toContain('font-family="Inter"')
    expect(svg).toContain('font-size="20"')
    expect((svg.match(/<tspan/g) ?? []).length).toBe(2) // one per line
    expect(svg).toContain('y="30"') // second baseline at leading * size
    expect(svg).toContain('transform="matrix(1,0,0,1,100,50)"') // POSITIONING RULE
  })

  it('path text exports one rotated tspan per glyph', () => {
    const store = createEditorStore()
    const path = createSubPath(
      [createAnchor({ x: 0, y: 0 }), createAnchor({ x: 0, y: 100 })], // straight DOWN
      false,
    )
    const node = createTextNode({ text: 'abc', fontSize: 16, textPath: [path] })
    cmdAddNode(store, node)
    const svg = documentToSVG(store.getState().document)
    expect((svg.match(/<tspan/g) ?? []).length).toBe(3)
    expect(svg).toContain('rotate="90"') // tangent points down
  })

  it('JSON round-trips the new optional fields exactly', () => {
    const store = createEditorStore()
    const node = createTextNode({
      text: 'x',
      kind: 'area',
      width: 120,
      height: 80,
      tracking: 50,
      kerning: false,
      vertical: true,
      pathStartOffset: 0.25,
    })
    cmdAddNode(store, node)
    const json = JSON.stringify(store.getState().document)
    const back = JSON.parse(json) as { nodes: Record<string, TextNode> }
    expect(back.nodes[node.id]).toEqual(store.getState().document.nodes[node.id])
  })
})

describe('cmdSetTextAttrs', () => {
  it('edits every selected text node in one undo step', () => {
    const store = createEditorStore()
    const a = createTextNode({ text: 'a' })
    const b = createTextNode({ text: 'b' })
    cmdAddNode(store, a)
    cmdAddNode(store, b)
    const before = store.getState().history.undoStack.length
    cmdSetTextAttrs(store, [a.id, b.id], 'Font Size', (n) => (n.fontSize = 48))
    const state = store.getState()
    expect(state.history.undoStack.length - before).toBe(1)
    expect((state.document.nodes[a.id] as TextNode).fontSize).toBe(48)
    expect((state.document.nodes[b.id] as TextNode).fontSize).toBe(48)
    state.undo()
    expect((store.getState().document.nodes[a.id] as TextNode).fontSize).toBe(24)
  })
})

describe('cmdConvertTextToOutlines', () => {
  const fakeOutline = (node: TextNode): SubPath[] => [
    createSubPath(
      [
        createAnchor({ x: 0, y: -node.fontSize }),
        createAnchor({ x: node.fontSize, y: -node.fontSize }),
        createAnchor({ x: node.fontSize, y: 0 }),
      ],
      true,
    ),
  ]

  it('replaces text IN PLACE: same id, transform, z; undo restores text', () => {
    const store = createEditorStore()
    const node = createTextNode({ text: 'A', fontSize: 30 }, { transform: [1, 0, 0, 1, 40, 40] })
    cmdAddNode(store, node)
    const [id] = cmdConvertTextToOutlines(store, [node.id], fakeOutline)
    expect(id).toBe(node.id) // SAME id
    const converted = store.getState().document.nodes[node.id] as PathNode
    expect(converted.type).toBe('path')
    expect(converted.transform).toEqual([1, 0, 0, 1, 40, 40])
    expect(converted.subpaths).toHaveLength(1)
    expect(converted.style.fillRule).toBe('nonzero') // font winding
    expect(store.getState().history.undoStack.at(-1)!.label).toBe('Convert to Outlines')
    store.getState().undo()
    expect(store.getState().document.nodes[node.id]!.type).toBe('text')
  })
})

describe('finishTextEdit', () => {
  it('commits a non-empty session as ONE undo step', () => {
    const store = createEditorStore()
    const state = store.getState()
    const node = createTextNode({ text: '' })
    state.beginTransaction('Add Text')
    cmdAddNode(store, node)
    state.setTextEdit({ nodeId: node.id })
    state.applyCommand('Edit Text', (doc) => {
      ;(doc.nodes[node.id] as TextNode).text = 'hello'
    })
    finishTextEdit(store)
    const after = store.getState()
    expect(after.ui.textEdit).toBeNull()
    expect((after.document.nodes[node.id] as TextNode).text).toBe('hello')
    expect(after.history.undoStack).toHaveLength(1)
    expect(after.history.undoStack[0]!.label).toBe('Add Text')
  })

  it('rolls the whole session back when the text ended up empty', () => {
    const store = createEditorStore()
    const state = store.getState()
    const node = createTextNode({ text: '' })
    state.beginTransaction('Add Text')
    cmdAddNode(store, node)
    state.setTextEdit({ nodeId: node.id })
    finishTextEdit(store)
    expect(store.getState().document.nodes[node.id]).toBeUndefined() // evaporated
    expect(store.getState().history.undoStack).toHaveLength(0)
  })
})
