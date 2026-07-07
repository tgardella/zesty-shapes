/**
 * Pathfinder panel: boolean shape combinations over the selection.
 * Shape modes (Unite / Minus Front / Intersect / Exclude) replace the
 * operands with ONE compound path; Divide / Trim / Merge produce a group of
 * pieces. Outline Stroke bakes selected strokes (uniform or variable-width)
 * into real filled outline paths. All are single undo steps via
 * store/booleanCommands.
 */

import { cmdOutlineStroke, cmdPathfinder, type PathfinderOp } from '../store/booleanCommands'
import { editorStore, useEditor } from '../store/store'

const OPS: Array<{ op: PathfinderOp; label: string; title: string }> = [
  { op: 'unite', label: 'Unite', title: 'Combine into one shape (top style)' },
  { op: 'minusFront', label: 'Minus', title: 'Subtract front objects from the back one' },
  { op: 'intersect', label: 'Intersect', title: 'Keep only the shared area' },
  { op: 'exclude', label: 'Exclude', title: 'Remove overlapping areas (XOR)' },
  { op: 'divide', label: 'Divide', title: 'Split into every atomic region' },
  { op: 'trim', label: 'Trim', title: 'Each object keeps its visible part' },
  { op: 'merge', label: 'Merge', title: 'Trim, then unite same-fill pieces' },
]

export function PathfinderPanel() {
  const selection = useEditor((s) => s.selection)
  const nodes = useEditor((s) => s.document.nodes)
  const enough = selection.length >= 2
  const canOutline = selection.some((id) => {
    const node = nodes[id]
    return !!node && node.type !== 'text' && (node.type === 'group' || node.style.stroke !== null)
  })

  // Contextual: the Pathfinder's boolean ops need ≥2 shapes. (Outline-stroke
  // on a single shape stays available from the toolbar.)
  if (!enough) return null

  return (
    <div className="panel">
      <div className="panel-title">Pathfinder</div>
      <div className="pathfinder-grid">
        {OPS.map(({ op, label, title }) => (
          <button
            key={op}
            type="button"
            className="panel-btn pf-btn"
            title={title}
            disabled={!enough}
            onClick={() => cmdPathfinder(editorStore, op, editorStore.getState().selection)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="panel-btn pf-btn"
          title="Convert strokes (incl. variable width) to filled outline paths"
          disabled={!canOutline}
          onClick={() => cmdOutlineStroke(editorStore, editorStore.getState().selection)}
        >
          Outline
        </button>
      </div>
    </div>
  )
}
