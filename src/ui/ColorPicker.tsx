/**
 * Compact HSB color picker: saturation/brightness area + hue and alpha
 * sliders + RGB/HSB/HEX fields. Fully controlled from the outside via RGBA
 * (the model's stored representation); HSB lives only in local state so hue
 * survives passing through black/white/gray.
 *
 * Drag lifecycle: onDragStart/onDragEnd bracket pointer drags so the caller
 * can coalesce the churn into ONE undo transaction; every onChange in between
 * is a live preview.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { RGBA } from '../model/types'
import {
  clampRGBA,
  hexToRgb,
  hsbToRgb,
  rgbaEquals,
  rgbToHex,
  rgbToHsb,
  type HSB,
} from '../model/color'

export interface ColorPickerProps {
  color: RGBA
  onChange(color: RGBA): void
  onDragStart?(): void
  onDragEnd?(): void
}

const CHECKER =
  'repeating-conic-gradient(#c8ccd8 0% 25%, #ffffff 0% 50%) 0 0 / 10px 10px'

export function ColorPicker({ color, onChange, onDragStart, onDragEnd }: ColorPickerProps) {
  const [hsb, setHsb] = useState<HSB>(() => rgbToHsb(color))
  const [mode, setMode] = useState<'rgb' | 'hsb'>('rgb')
  const lastEmitted = useRef<RGBA>(color)

  // Resync local HSB only for EXTERNAL color changes (selection switch,
  // undo...) — not for our own echoes, which would destroy hue on grays.
  useEffect(() => {
    if (!rgbaEquals(color, lastEmitted.current)) {
      setHsb(rgbToHsb(color))
      lastEmitted.current = color
    }
  }, [color])

  const emitHsb = (next: HSB, alpha = color.a): void => {
    setHsb(next)
    const rgba = hsbToRgb(next, alpha)
    lastEmitted.current = rgba
    onChange(rgba)
  }
  const emitRgba = (next: RGBA): void => {
    const c = clampRGBA(next)
    setHsb(rgbToHsb(c))
    lastEmitted.current = c
    onChange(c)
  }

  // -- drag plumbing shared by the SV area and both sliders --------------------
  const dragTo = useRef<(e: PointerEvent | ReactPointerEvent) => void>(() => {})
  const startDrag = (
    e: ReactPointerEvent<HTMLDivElement>,
    apply: (x: number, y: number, rect: DOMRect) => void,
  ): void => {
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    const run = (ev: PointerEvent | ReactPointerEvent): void => {
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width))
      const y = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height))
      apply(x, y, rect)
    }
    dragTo.current = run
    onDragStart?.()
    run(e)
    const move = (ev: PointerEvent): void => dragTo.current(ev)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onDragEnd?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    e.preventDefault()
  }

  const hueColor = hsbToRgb({ h: hsb.h, s: 100, b: 100 })
  const opaque = { ...color, a: 1 }

  return (
    <div className="color-picker">
      <div
        className="cp-sv"
        style={{ backgroundColor: rgbToHex(hueColor) }}
        onPointerDown={(e) =>
          startDrag(e, (x, y) => emitHsb({ h: hsb.h, s: x * 100, b: (1 - y) * 100 }))
        }
      >
        <div
          className="cp-sv-cursor"
          style={{ left: `${hsb.s}%`, top: `${100 - hsb.b}%` }}
        />
      </div>
      <div
        className="cp-slider cp-hue"
        onPointerDown={(e) => startDrag(e, (x) => emitHsb({ ...hsb, h: x * 360 }))}
      >
        <div className="cp-slider-thumb" style={{ left: `${(hsb.h / 360) * 100}%` }} />
      </div>
      <div
        className="cp-slider"
        style={{ background: CHECKER }}
        onPointerDown={(e) => startDrag(e, (x) => emitRgba({ ...color, a: x }))}
      >
        <div
          className="cp-slider-fill"
          style={{
            background: `linear-gradient(90deg, transparent, ${rgbToHex(opaque)})`,
          }}
        />
        <div className="cp-slider-thumb" style={{ left: `${color.a * 100}%` }} />
      </div>

      <div className="cp-fields">
        <select
          className="cp-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as 'rgb' | 'hsb')}
        >
          <option value="rgb">RGB</option>
          <option value="hsb">HSB</option>
        </select>
        {mode === 'rgb' ? (
          <>
            <NumField value={color.r} max={255} onCommit={(v) => emitRgba({ ...color, r: v })} />
            <NumField value={color.g} max={255} onCommit={(v) => emitRgba({ ...color, g: v })} />
            <NumField value={color.b} max={255} onCommit={(v) => emitRgba({ ...color, b: v })} />
          </>
        ) : (
          <>
            <NumField value={hsb.h} max={360} onCommit={(v) => emitHsb({ ...hsb, h: v })} />
            <NumField value={hsb.s} max={100} onCommit={(v) => emitHsb({ ...hsb, s: v })} />
            <NumField value={hsb.b} max={100} onCommit={(v) => emitHsb({ ...hsb, b: v })} />
          </>
        )}
        <NumField
          value={Math.round(color.a * 100)}
          max={100}
          suffix="%"
          onCommit={(v) => emitRgba({ ...color, a: v / 100 })}
        />
      </div>
      <HexField color={color} onCommit={emitRgba} />
    </div>
  )
}

/** Numeric field that commits on Enter/blur (never per keystroke). */
export function NumField({
  value,
  onCommit,
  min = 0,
  max,
  step = 1,
  suffix,
  title,
}: {
  value: number
  onCommit(v: number): void
  min?: number
  max?: number
  step?: number
  suffix?: string
  title?: string
}) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? String(Math.round(value * 100) / 100)
  const commit = (): void => {
    if (text === null) return
    const v = parseFloat(text)
    setText(null)
    if (!Number.isFinite(v)) return
    const clamped = Math.max(min, max !== undefined ? Math.min(max, v) : v)
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <span className="num-field" title={title}>
      <input
        type="number"
        value={shown}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          e.stopPropagation() // never let editor shortcuts fire while typing
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </span>
  )
}

function HexField({ color, onCommit }: { color: RGBA; onCommit(c: RGBA): void }) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? rgbToHex(color)
  const commit = (): void => {
    if (text === null) return
    const parsed = hexToRgb(text, color.a)
    setText(null)
    if (parsed) onCommit(parsed)
  }
  return (
    <div className="cp-hex">
      <span>HEX</span>
      <input
        value={shown}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          e.stopPropagation()
        }}
      />
    </div>
  )
}
