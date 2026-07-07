/**
 * Align & Distribute panel: alignment relative to the selection's union
 * world bbox (≥2 objects), distribution of bbox centers (≥3 objects).
 */

import type { ReactNode } from 'react'
import { cmdAlignNodes, cmdDistributeNodes, type AlignMode } from '../store/commands'
import { editorStore, useEditor } from '../store/store'

const ALIGN_BUTTONS: Array<{ mode: AlignMode; title: string; icon: ReactNode }> = [
  { mode: 'left', title: 'Align left', icon: <AlignIcon edge="left" /> },
  { mode: 'hcenter', title: 'Align horizontal center', icon: <AlignIcon edge="hcenter" /> },
  { mode: 'right', title: 'Align right', icon: <AlignIcon edge="right" /> },
  { mode: 'top', title: 'Align top', icon: <AlignIcon edge="top" /> },
  { mode: 'vcenter', title: 'Align vertical center', icon: <AlignIcon edge="vcenter" /> },
  { mode: 'bottom', title: 'Align bottom', icon: <AlignIcon edge="bottom" /> },
]

function AlignIcon({ edge }: { edge: AlignMode }) {
  // A guide line + two bars aligned to it.
  const vertical = edge === 'left' || edge === 'hcenter' || edge === 'right'
  const linePos = edge === 'left' || edge === 'top' ? 3 : edge === 'right' || edge === 'bottom' ? 13 : 8
  const bar = (offset: number, len: number) => {
    const start = edge === 'left' || edge === 'top' ? linePos : edge === 'right' || edge === 'bottom' ? linePos - len : linePos - len / 2
    return vertical ? (
      <rect x={start} y={offset} width={len} height={3.2} rx={0.8} fill="currentColor" />
    ) : (
      <rect x={offset} y={start} width={3.2} height={len} rx={0.8} fill="currentColor" />
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {vertical ? (
        <line x1={linePos} y1={1} x2={linePos} y2={15} stroke="currentColor" strokeWidth={1.2} />
      ) : (
        <line x1={1} y1={linePos} x2={15} y2={linePos} stroke="currentColor" strokeWidth={1.2} />
      )}
      {bar(3, 9)}
      {bar(9.5, 6)}
    </svg>
  )
}

function DistributeIcon({ axis }: { axis: 'h' | 'v' }) {
  const bars =
    axis === 'h'
      ? [
          <rect key="a" x={2} y={4} width={3} height={8} rx={0.8} fill="currentColor" />,
          <rect key="b" x={6.5} y={4} width={3} height={8} rx={0.8} fill="currentColor" />,
          <rect key="c" x={11} y={4} width={3} height={8} rx={0.8} fill="currentColor" />,
        ]
      : [
          <rect key="a" x={4} y={2} width={8} height={3} rx={0.8} fill="currentColor" />,
          <rect key="b" x={4} y={6.5} width={8} height={3} rx={0.8} fill="currentColor" />,
          <rect key="c" x={4} y={11} width={8} height={3} rx={0.8} fill="currentColor" />,
        ]
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {bars}
    </svg>
  )
}

export function AlignPanel() {
  const selectionCount = useEditor((s) => s.selection.length)
  const align = (mode: AlignMode) =>
    cmdAlignNodes(editorStore, editorStore.getState().selection, mode)
  const distribute = (axis: 'h' | 'v') =>
    cmdDistributeNodes(editorStore, editorStore.getState().selection, axis)

  // Contextual: alignment needs at least two objects to be meaningful.
  if (selectionCount < 2) return null

  return (
    <div className="panel">
      <div className="panel-title">Align</div>
      <div className="align-grid">
        {ALIGN_BUTTONS.map((b) => (
          <button
            key={b.mode}
            type="button"
            className="panel-btn"
            title={b.title}
            disabled={selectionCount < 2}
            onClick={() => align(b.mode)}
          >
            {b.icon}
          </button>
        ))}
        <button
          type="button"
          className="panel-btn"
          title="Distribute horizontally"
          disabled={selectionCount < 3}
          onClick={() => distribute('h')}
        >
          <DistributeIcon axis="h" />
        </button>
        <button
          type="button"
          className="panel-btn"
          title="Distribute vertically"
          disabled={selectionCount < 3}
          onClick={() => distribute('v')}
        >
          <DistributeIcon axis="v" />
        </button>
      </div>
    </div>
  )
}
