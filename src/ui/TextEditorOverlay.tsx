/**
 * In-place text editing: an HTML <textarea> positioned over the text node
 * through the SAME transform pipeline the canvas uses (viewport matrix x
 * worldTransform), so editing tracks pan/zoom/rotation exactly. The SVG
 * <text> hides itself while its node is in ui.textEdit; this overlay IS the
 * live view (same font/size/leading/tracking/alignment).
 *
 * Every keystroke updates node.text inside the open 'Add Text'/'Edit Text'
 * transaction; Escape and blur COMMIT via finishTextEdit (empty sessions
 * roll back, evaporating freshly created nodes).
 */

import { useEffect, useRef } from 'react'
import { compose, toSvgTransform, translate } from '../geometry/matrix'
import { ascentOf, measureText } from '../model/textMetrics'
import { fontSpecOf, layoutText } from '../model/textLayout'
import { pointAtOffset, samplePath } from '../model/widthProfile'
import { cmdUpdateNode } from '../store/commands'
import { finishTextEdit } from '../store/textCommands'
import { editorStore, useEditor } from '../store/store'
import { worldTransform } from '../store/worldTransform'

export function TextEditorOverlay() {
  const node = useEditor((s) =>
    s.ui.textEdit ? s.document.nodes[s.ui.textEdit.nodeId] : undefined,
  )
  const nodes = useEditor((s) => s.document.nodes)
  const viewport = useEditor((s) => s.viewport)
  const ref = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (node) {
      ref.current?.focus()
      const len = ref.current?.value.length ?? 0
      ref.current?.setSelectionRange(len, len)
    }
  }, [node?.id])

  if (!node || node.type !== 'text') return null

  const layout = layoutText(node)
  const isArea = node.kind === 'area' && (node.width ?? 0) > 0
  const isPath = !!node.textPath && node.textPath.length > 0
  // Path text edits in a plain box anchored at the TEXT START POINT on the
  // path (where the user clicked / the Start % offset) so it is on-screen at
  // any zoom — not at the node's local origin.
  let pathAnchor = { x: 0, y: 0 }
  if (isPath) {
    const sampled = samplePath(node.textPath!)
    if (sampled) pathAnchor = pointAtOffset(sampled, node.pathStartOffset ?? 0).point
  }
  // Local top-left of the editing box; point text hangs from the baseline.
  const ascent = ascentOf(node.fontSize)
  const boxX = isArea ? 0 : isPath ? pathAnchor.x : Math.min(layout.bbox.minX, 0)
  const boxY = isArea ? 0 : (isPath ? pathAnchor.y : 0) - ascent
  const boxW = isPath
    ? Math.max(measureText(node.text, fontSpecOf(node)) + node.fontSize, 60)
    : Math.max(isArea ? node.width! : layout.bbox.maxX - layout.bbox.minX + node.fontSize, 60)
  const boxH = isPath
    ? node.fontSize * node.leading * 1.3
    : Math.max(
        isArea ? (node.height ?? 0) : layout.bbox.maxY + ascent + node.fontSize * 0.4,
        node.fontSize * node.leading * 1.3,
      )

  // screen = viewport ∘ world ∘ local-box-offset, applied as one CSS matrix.
  const world = worldTransform(nodes, node.id)
  const screen = compose(
    [viewport.zoom, 0, 0, viewport.zoom, viewport.tx, viewport.ty],
    world,
    translate(boxX, boxY),
  )
  const trackPx = ((node.tracking ?? 0) / 1000) * node.fontSize

  const onInput = (value: string): void => {
    cmdUpdateNode(editorStore, node.id, 'Edit Text', (n) => {
      if (n.type === 'text') n.text = value
    })
  }

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={node.text}
      spellCheck={false}
      style={{
        transform: toSvgTransform(screen), // matrix(a,b,c,d,e,f) is valid CSS too
        width: boxW,
        height: boxH,
        fontFamily: node.fontFamily,
        fontSize: node.fontSize,
        fontWeight: node.fontWeight,
        lineHeight: `${node.fontSize * node.leading}px`,
        letterSpacing: trackPx !== 0 ? `${trackPx}px` : undefined,
        textAlign: node.textAlign,
        fontKerning: (node.kerning ?? true) ? 'auto' : 'none',
        whiteSpace: isArea ? 'pre-wrap' : 'pre', // area text wraps like the layout
      }}
      onChange={(e) => onInput(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          finishTextEdit(editorStore)
        }
      }}
      onBlur={() => finishTextEdit(editorStore)}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}
