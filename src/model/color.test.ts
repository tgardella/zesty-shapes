import { describe, expect, it } from 'vitest'
import { hexToRgb, hsbToRgb, mixRGBA, rgbaEquals, rgbToHex, rgbToHsb } from './color'

describe('rgb <-> hsb', () => {
  it('round-trips primaries and mixes', () => {
    for (const c of [
      { r: 255, g: 0, b: 0, a: 1 },
      { r: 0, g: 255, b: 0, a: 1 },
      { r: 0, g: 0, b: 255, a: 0.5 },
      { r: 37, g: 142, b: 201, a: 1 },
      { r: 255, g: 255, b: 255, a: 1 },
      { r: 0, g: 0, b: 0, a: 1 },
    ]) {
      const back = hsbToRgb(rgbToHsb(c), c.a)
      expect(rgbaEquals(back, c)).toBe(true)
    }
  })

  it('maps the known landmarks', () => {
    expect(rgbToHsb({ r: 255, g: 0, b: 0, a: 1 })).toEqual({ h: 0, s: 100, b: 100 })
    expect(rgbToHsb({ r: 0, g: 255, b: 0, a: 1 }).h).toBe(120)
    expect(rgbToHsb({ r: 0, g: 0, b: 255, a: 1 }).h).toBe(240)
    expect(rgbToHsb({ r: 128, g: 128, b: 128, a: 1 }).s).toBe(0)
  })
})

describe('hex', () => {
  it('formats and parses #RRGGBB', () => {
    expect(rgbToHex({ r: 59, g: 130, b: 246, a: 1 })).toBe('#3B82F6')
    expect(hexToRgb('#3b82f6')).toEqual({ r: 59, g: 130, b: 246, a: 1 })
    expect(hexToRgb('3B82F6', 0.5)).toEqual({ r: 59, g: 130, b: 246, a: 0.5 })
  })

  it('parses #RGB and #RRGGBBAA', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(hexToRgb('#00000080')!.a).toBeCloseTo(0.502, 2)
  })

  it('rejects malformed input', () => {
    expect(hexToRgb('#12')).toBeNull()
    expect(hexToRgb('hello!')).toBeNull()
    expect(hexToRgb('#12345')).toBeNull()
  })
})

describe('mixRGBA', () => {
  it('interpolates channels and alpha', () => {
    const m = mixRGBA({ r: 0, g: 0, b: 0, a: 0 }, { r: 255, g: 100, b: 50, a: 1 }, 0.5)
    expect(m).toEqual({ r: 128, g: 50, b: 25, a: 0.5 })
  })
})
