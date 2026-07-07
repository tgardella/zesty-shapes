/**
 * Fill & Stroke panel:
 * - fill/stroke swatch proxies (click = activate target), swap, none
 * - paint kind per target: none / solid / linear / radial
 * - solid: HSB/RGB/HEX picker with alpha; gradient: stop strip editor
 *   (click adds a stop, drag moves it, per-stop color + offset) + type
 * - stroke options: width, cap, join, dash pattern
 * - node opacity (selection only)
 *
 * Edits apply to the SELECTION (groups recurse to leaves) as labeled undo
 * commands; picker drags coalesce into one transaction. With nothing selected
 * the panel edits ui.currentStyle — the appearance new objects are born with
 * (never undoable, like selection).
 */

import { useState } from 'react'
import type {
  DropShadow,
  GradientPaint,
  Paint,
  RGBA,
  Style,
  StrokeCap,
  StrokeJoin,
} from '../model/types'
import { cssColor } from '../model/defs'
import { mixRGBA } from '../model/color'
import { cloneStyle } from '../model/nodes'
import {
  defaultGradientFrom,
  defaultGradientTransform,
  linearAxisTransform,
} from '../model/gradientGeometry'
import { sortedProfile } from '../model/widthProfile'
import { cmdSetOpacity, cmdSetStyle, cmdSwapFillStroke, stylableLeafIds } from '../store/commands'
import { editorStore, useEditor, type StyleTarget } from '../store/store'
import { ColorPicker, NumField } from './ColorPicker'

const GRAY: RGBA = { r: 128, g: 128, b: 128, a: 1 }
const CHECKER = 'repeating-conic-gradient(#c8ccd8 0% 25%, #ffffff 0% 50%) 0 0 / 8px 8px'

type PaintKind = 'none' | 'solid' | 'linear' | 'radial'

function paintKindOf(paint: Paint | null): PaintKind {
  if (paint === null) return 'none'
  return paint.type === 'solid' ? 'solid' : paint.gradientType
}

/** CSS preview of a paint (checkerboard shows through alpha / none). */
function paintCss(paint: Paint | null): string {
  if (paint === null) return ''
  if (paint.type === 'solid') {
    const c = paint.color
    return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a})`
  }
  return gradientCss(paint, paint.gradientType === 'radial')
}

function gradientCss(paint: GradientPaint, radial = false): string {
  const stops = [...paint.stops]
    .sort((a, b) => a.offset - b.offset)
    .map((s) => {
      const c = s.color
      return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a}) ${s.offset * 100}%`
    })
    .join(', ')
  return radial ? `radial-gradient(circle, ${stops})` : `linear-gradient(90deg, ${stops})`
}

/** A representative color for kind conversions (first stop / solid / gray). */
function representativeColor(paint: Paint | null): RGBA {
  if (paint === null) return GRAY
  if (paint.type === 'solid') return { ...paint.color }
  return paint.stops[0] ? { ...paint.stops[0].color } : GRAY
}

export function AppearancePanel() {
  const selection = useEditor((s) => s.selection)
  const nodes = useEditor((s) => s.document.nodes)
  const root = useEditor((s) => s.document.root)
  const target = useEditor((s) => s.ui.styleTarget)
  const currentStyle = useEditor((s) => s.ui.currentStyle)
  const [stopIndex, setStopIndex] = useState(0)

  const leafIds = stylableLeafIds(nodes, selection, root)
  const displayStyle: Style = leafIds.length > 0 ? nodes[leafIds[0]!]!.style : currentStyle
  const paint = displayStyle[target]
  const kind = paintKindOf(paint)

  /** One labeled edit, to the selection or (unselected) the current style. */
  const apply = (label: string, mutate: (style: Style) => void): void => {
    if (leafIds.length > 0) {
      cmdSetStyle(editorStore, selection, label, mutate)
    } else {
      const next = cloneStyle(currentStyle)
      mutate(next)
      editorStore.getState().setCurrentStyle(next)
    }
  }
  /** Bracket a picker drag into ONE undo step (no-op for currentStyle). */
  const dragStart = (label: string) => (): void => {
    if (leafIds.length > 0) editorStore.getState().beginTransaction(label)
  }
  const dragEnd = (): void => {
    editorStore.getState().commitTransaction()
  }

  const colorLabel = target === 'fill' ? 'Fill Color' : 'Stroke Color'

  const setKind = (next: PaintKind): void => {
    if (next === kind) return
    const from = representativeColor(paint)
    apply(target === 'fill' ? 'Fill' : 'Stroke', (style) => {
      if (next === 'none') {
        style[target] = null
        return
      }
      if (next === 'solid') {
        style[target] = { type: 'solid', color: representativeColor(style[target]) }
        return
      }
      const existing = style[target]
      if (existing && existing.type === 'gradient') {
        existing.gradientType = next // keep stops + placement
        return
      }
      style[target] = defaultGradientFrom(from, next, linearAxisTransform({ x: 0, y: 0 }, { x: 100, y: 0 }))
    })
    // Panel-applied gradients get fitted per node (bbox default) in a second
    // pass — cmdSetStyle exposes the node, so refit inside the same command
    // would need node context; do it here for the selection case.
    if ((next === 'linear' || next === 'radial') && leafIds.length > 0) {
      cmdSetStyle(editorStore, selection, target === 'fill' ? 'Fill' : 'Stroke', (style, node) => {
        const p = style[target]
        if (p && p.type === 'gradient') {
          p.transform = defaultGradientTransform(node, editorStore.getState().document.nodes, next)
        }
      })
    }
    setStopIndex(0)
  }

  return (
    <div className="panel appearance-panel">
      <div className="panel-title">Appearance</div>

      <div className="swatch-row">
        <button
          type="button"
          className={`swatch fill-swatch${target === 'fill' ? ' active' : ''}`}
          title="Fill (click to edit)"
          onClick={() => editorStore.getState().setStyleTarget('fill')}
        >
          <span className="swatch-checker" style={{ background: CHECKER }} />
          <span className="swatch-paint" style={{ background: paintCss(displayStyle.fill) }} />
          {displayStyle.fill === null && <span className="swatch-none" />}
        </button>
        <button
          type="button"
          className={`swatch stroke-swatch${target === 'stroke' ? ' active' : ''}`}
          title="Stroke (click to edit)"
          onClick={() => editorStore.getState().setStyleTarget('stroke')}
        >
          <span className="swatch-checker" style={{ background: CHECKER }} />
          <span className="swatch-paint" style={{ background: paintCss(displayStyle.stroke) }} />
          <span className="swatch-hole" />
          {displayStyle.stroke === null && <span className="swatch-none" />}
        </button>
        <button
          type="button"
          className="panel-btn swap-btn"
          title="Swap fill & stroke"
          onClick={() => {
            if (leafIds.length > 0) cmdSwapFillStroke(editorStore, selection)
            else {
              const next = cloneStyle(currentStyle)
              const fill = next.fill
              next.fill = next.stroke
              next.stroke = fill
              editorStore.getState().setCurrentStyle(next)
            }
          }}
        >
          ⇄
        </button>
        {leafIds.length === 0 && <span className="panel-hint">new art</span>}
      </div>

      <div className="kind-row">
        {(['none', 'solid', 'linear', 'radial'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`panel-btn kind-btn${kind === k ? ' active' : ''}`}
            onClick={() => setKind(k)}
          >
            {k === 'none' ? 'None' : k === 'solid' ? 'Solid' : k === 'linear' ? 'Linear' : 'Radial'}
          </button>
        ))}
      </div>

      {paint?.type === 'solid' && (
        <ColorPicker
          color={paint.color}
          onChange={(c) =>
            apply(colorLabel, (style) => {
              style[target] = { type: 'solid', color: c }
            })
          }
          onDragStart={dragStart(colorLabel)}
          onDragEnd={dragEnd}
        />
      )}

      {paint?.type === 'gradient' && (
        <GradientEditor
          paint={paint}
          stopIndex={Math.min(stopIndex, paint.stops.length - 1)}
          setStopIndex={setStopIndex}
          apply={apply}
          dragStart={dragStart}
          dragEnd={dragEnd}
          target={target}
        />
      )}

      <StrokeOptions style={displayStyle} apply={apply} />
      <DropShadowOptions style={displayStyle} apply={apply} dragStart={dragStart} dragEnd={dragEnd} />
      {selection.length > 0 && (
        <div className="stroke-row">
          <span className="row-label">Opacity</span>
          <NumField
            value={Math.round((nodes[selection[0]!]?.opacity ?? 1) * 100)}
            max={100}
            suffix="%"
            onCommit={(v) => cmdSetOpacity(editorStore, selection, v / 100)}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gradient stop editor
// ---------------------------------------------------------------------------

function GradientEditor({
  paint,
  stopIndex,
  setStopIndex,
  apply,
  dragStart,
  dragEnd,
  target,
}: {
  paint: GradientPaint
  stopIndex: number
  setStopIndex(i: number): void
  apply(label: string, mutate: (style: Style) => void): void
  dragStart(label: string): () => void
  dragEnd(): void
  target: StyleTarget
}) {
  const stop = paint.stops[stopIndex] ?? paint.stops[0]!
  const editStops = (label: string, mutate: (p: GradientPaint) => void): void => {
    apply(label, (style) => {
      const p = style[target]
      if (p && p.type === 'gradient') mutate(p)
    })
  }

  /** Click on the strip = add a stop; drag a marker = move it. */
  const onStripPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const strip = e.currentTarget
    const rect = strip.getBoundingClientRect()
    const offsetAt = (clientX: number): number =>
      Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const u = offsetAt(e.clientX)

    // Nearest existing marker within 6px?
    let hit = -1
    let hitDist = 7
    for (let i = 0; i < paint.stops.length; i++) {
      const d = Math.abs(e.clientX - (rect.left + paint.stops[i]!.offset * rect.width))
      if (d < hitDist) {
        hit = i
        hitDist = d
      }
    }

    // The whole gesture (optional add + all moves) is ONE transaction.
    dragStart(hit === -1 ? 'Add Gradient Stop' : 'Move Gradient Stop')()
    let index = hit
    if (hit === -1) {
      // Insert a new stop with the color the gradient already has there.
      const sorted = [...paint.stops].sort((a, b) => a.offset - b.offset)
      let color = sorted[u > sorted[sorted.length - 1]!.offset ? sorted.length - 1 : 0]!.color
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]!
        const b = sorted[i + 1]!
        if (u >= a.offset && u <= b.offset) {
          const span = b.offset - a.offset
          color = mixRGBA(a.color, b.color, span < 1e-9 ? 0 : (u - a.offset) / span)
          break
        }
      }
      index = paint.stops.length
      editStops('Add Gradient Stop', (p) => {
        p.stops.push({ offset: u, color: { ...color } })
      })
    }
    setStopIndex(index)

    const move = (ev: PointerEvent): void => {
      const next = offsetAt(ev.clientX)
      editStops('Move Gradient Stop', (p) => {
        const s = p.stops[index]
        if (s) s.offset = next
      })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragEnd()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    e.preventDefault()
  }

  return (
    <div className="gradient-editor">
      <div className="grad-strip-wrap">
        <div className="grad-strip-checker" style={{ background: CHECKER }} />
        <div
          className="grad-strip"
          style={{ background: gradientCss(paint) }}
          onPointerDown={onStripPointerDown}
        />
        {paint.stops.map((s, i) => (
          <div
            key={i}
            className={`grad-marker${i === stopIndex ? ' selected' : ''}`}
            style={{ left: `${s.offset * 100}%`, background: cssColor(s.color) }}
          />
        ))}
      </div>
      <div className="grad-stop-row">
        <span className="row-label">Stop</span>
        <NumField
          value={Math.round(stop.offset * 100)}
          max={100}
          suffix="%"
          onCommit={(v) =>
            editStops('Move Gradient Stop', (p) => {
              const s = p.stops[stopIndex]
              if (s) s.offset = v / 100
            })
          }
        />
        <button
          type="button"
          className="panel-btn"
          disabled={paint.stops.length <= 2}
          title="Delete stop"
          onClick={() => {
            editStops('Delete Gradient Stop', (p) => {
              p.stops.splice(stopIndex, 1)
            })
            setStopIndex(0)
          }}
        >
          −
        </button>
      </div>
      <ColorPicker
        color={stop.color}
        onChange={(c) =>
          editStops('Gradient Stop Color', (p) => {
            const s = p.stops[stopIndex]
            if (s) s.color = c
          })
        }
        onDragStart={dragStart('Gradient Stop Color')}
        onDragEnd={dragEnd}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drop shadow (live SVG filter effect)
// ---------------------------------------------------------------------------

const DEFAULT_SHADOW: DropShadow = {
  offsetX: 4,
  offsetY: 4,
  blur: 4,
  color: { r: 0, g: 0, b: 0, a: 0.5 },
}

function DropShadowOptions({
  style,
  apply,
  dragStart,
  dragEnd,
}: {
  style: Style
  apply(label: string, mutate: (style: Style) => void): void
  dragStart(label: string): () => void
  dragEnd(): void
}) {
  const shadow = style.dropShadow
  const editShadow = (mutate: (sh: DropShadow) => void): void => {
    apply('Drop Shadow', (s) => {
      if (s.dropShadow) mutate(s.dropShadow)
    })
  }
  return (
    <div className="stroke-options">
      <div className="stroke-row">
        <span className="row-label">Drop Shadow</span>
        <button
          type="button"
          className={`panel-btn seg-btn${shadow ? ' active' : ''}`}
          onClick={() =>
            apply(shadow ? 'Remove Drop Shadow' : 'Drop Shadow', (s) => {
              if (s.dropShadow) delete s.dropShadow
              else s.dropShadow = { ...DEFAULT_SHADOW, color: { ...DEFAULT_SHADOW.color } }
            })
          }
        >
          {shadow ? 'On' : 'Off'}
        </button>
      </div>
      {shadow && (
        <>
          <div className="stroke-row">
            <span className="row-label">Offset X</span>
            <NumField
              value={shadow.offsetX}
              step={1}
              onCommit={(v) => editShadow((sh) => (sh.offsetX = v))}
            />
            <span className="row-label">Y</span>
            <NumField
              value={shadow.offsetY}
              step={1}
              onCommit={(v) => editShadow((sh) => (sh.offsetY = v))}
            />
          </div>
          <div className="stroke-row">
            <span className="row-label">Blur</span>
            <NumField
              value={shadow.blur}
              min={0}
              step={0.5}
              onCommit={(v) => editShadow((sh) => (sh.blur = v))}
            />
          </div>
          <ColorPicker
            color={shadow.color}
            onChange={(c) => editShadow((sh) => (sh.color = c))}
            onDragStart={dragStart('Drop Shadow Color')}
            onDragEnd={dragEnd}
          />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stroke options
// ---------------------------------------------------------------------------

const CAPS: StrokeCap[] = ['butt', 'round', 'square']
const JOINS: StrokeJoin[] = ['miter', 'round', 'bevel']

function StrokeOptions({
  style,
  apply,
}: {
  style: Style
  apply(label: string, mutate: (style: Style) => void): void
}) {
  const [dashText, setDashText] = useState<string | null>(null)
  const dashShown = dashText ?? style.strokeDash.join(' ')
  const commitDash = (): void => {
    if (dashText === null) return
    const parts = dashText
      .split(/[\s,]+/)
      .map((p) => parseFloat(p))
      .filter((v) => Number.isFinite(v) && v >= 0)
    setDashText(null)
    apply('Stroke Dash', (s) => {
      s.strokeDash = parts
    })
  }
  const hasProfile = (style.widthProfile?.length ?? 0) > 0

  return (
    <div className="stroke-options">
      <div className="stroke-row">
        <span className="row-label">Width</span>
        <NumField
          value={style.strokeWidth}
          min={0}
          step={0.5}
          onCommit={(v) => apply('Stroke Width', (s) => (s.strokeWidth = v))}
        />
        {hasProfile && (
          <button
            type="button"
            className="panel-btn"
            title="Remove the variable width profile (back to uniform)"
            onClick={() => apply('Uniform Width', (s) => delete s.widthProfile)}
          >
            uniform
          </button>
        )}
      </div>
      <div className="stroke-row">
        <span className="row-label">Cap</span>
        {CAPS.map((cap) => (
          <button
            key={cap}
            type="button"
            className={`panel-btn seg-btn${style.strokeCap === cap ? ' active' : ''}`}
            onClick={() => apply('Stroke Cap', (s) => (s.strokeCap = cap))}
          >
            {cap}
          </button>
        ))}
      </div>
      <div className="stroke-row">
        <span className="row-label">Join</span>
        {JOINS.map((join) => (
          <button
            key={join}
            type="button"
            className={`panel-btn seg-btn${style.strokeJoin === join ? ' active' : ''}`}
            onClick={() => apply('Stroke Join', (s) => (s.strokeJoin = join))}
          >
            {join}
          </button>
        ))}
      </div>
      <div className="stroke-row">
        <span className="row-label">Dash</span>
        <input
          className="dash-input"
          placeholder="e.g. 4 2"
          value={dashShown}
          spellCheck={false}
          onChange={(e) => setDashText(e.target.value)}
          onBlur={commitDash}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDash()
            e.stopPropagation()
          }}
        />
      </div>
      {hasProfile && (
        <div className="panel-hint">
          Variable width: {sortedProfile(style.widthProfile!).length} points (Shift+W)
        </div>
      )}
    </div>
  )
}
