/**
 * Text panel (shown when the selection contains text): font family/size/
 * weight, leading, tracking, kerning, alignment, vertical orientation, and
 * Convert to Outlines (loads the bundled faces, then swaps each TextNode for
 * a PathNode in place). Every control edits ALL selected text nodes as one
 * labeled undo step via cmdSetTextAttrs.
 */

import { FONT_FAMILIES, ensureFontsLoaded, textToOutlineSubPaths } from '../rendering/fontKit'
import { cmdConvertTextToOutlines, cmdSetTextAttrs, textLeafIds } from '../store/textCommands'
import { editorStore, useEditor } from '../store/store'
import type { TextNode } from '../model/types'
import { NumField } from './ColorPicker'

const WEIGHTS = [300, 400, 500, 600, 700, 800]

export function TextPanel() {
  const selection = useEditor((s) => s.selection)
  const nodes = useEditor((s) => s.document.nodes)
  const textIds = textLeafIds(editorStore, selection)
  if (textIds.length === 0) return null
  const node = nodes[textIds[0]!] as TextNode

  const apply = (label: string, mutate: (n: TextNode) => void): void => {
    cmdSetTextAttrs(editorStore, selection, label, mutate)
  }

  return (
    <div className="panel">
      <div className="panel-title">Text</div>
      <div className="stroke-row">
        <select
          className="text-select"
          value={node.fontFamily}
          onChange={(e) => apply('Font Family', (n) => (n.fontFamily = e.target.value))}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select
          className="text-select weight-select"
          value={node.fontWeight}
          onChange={(e) => apply('Font Weight', (n) => (n.fontWeight = Number(e.target.value)))}
        >
          {WEIGHTS.map((w) => (
            <option key={w} value={w}>
              {w}
            </option>
          ))}
        </select>
      </div>
      <div className="stroke-row">
        <span className="row-label">Size</span>
        <NumField
          value={node.fontSize}
          min={1}
          onCommit={(v) => apply('Font Size', (n) => (n.fontSize = v))}
        />
        <span className="row-label">Lead</span>
        <NumField
          value={node.leading}
          min={0.5}
          max={4}
          step={0.1}
          onCommit={(v) => apply('Leading', (n) => (n.leading = v))}
        />
      </div>
      <div className="stroke-row">
        <span className="row-label">Track</span>
        <NumField
          value={node.tracking ?? 0}
          min={-500}
          max={2000}
          step={10}
          title="Tracking (1/1000 em)"
          onCommit={(v) => apply('Tracking', (n) => (n.tracking = v))}
        />
        <label className="text-check" title="Pair kerning from the font">
          <input
            type="checkbox"
            checked={node.kerning ?? true}
            onChange={(e) => apply('Kerning', (n) => (n.kerning = e.target.checked))}
          />
          kern
        </label>
      </div>
      <div className="stroke-row">
        <span className="row-label">Align</span>
        {(['left', 'center', 'right'] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={`panel-btn seg-btn${node.textAlign === a ? ' active' : ''}`}
            onClick={() => apply('Text Align', (n) => (n.textAlign = a))}
          >
            {a === 'left' ? 'L' : a === 'center' ? 'C' : 'R'}
          </button>
        ))}
        <label className="text-check" title="Vertical type">
          <input
            type="checkbox"
            checked={node.vertical ?? false}
            onChange={(e) =>
              apply('Vertical Type', (n) => {
                if (e.target.checked) n.vertical = true
                else delete n.vertical
              })
            }
          />
          vert
        </label>
      </div>
      {node.textPath && (
        <div className="stroke-row">
          <span className="row-label">Start</span>
          <NumField
            value={Math.round((node.pathStartOffset ?? 0) * 100)}
            max={100}
            suffix="%"
            title="Start offset along the path"
            onCommit={(v) => apply('Path Offset', (n) => (n.pathStartOffset = v / 100))}
          />
        </div>
      )}
      <button
        type="button"
        className="panel-btn outline-text-btn"
        title="Convert text to editable path outlines (bundled Inter glyphs)"
        onClick={() => {
          void ensureFontsLoaded().then(() => {
            cmdConvertTextToOutlines(
              editorStore,
              editorStore.getState().selection,
              textToOutlineSubPaths,
            )
          })
        }}
      >
        Convert to Outlines
      </button>
    </div>
  )
}
