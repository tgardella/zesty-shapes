import { describe, expect, it } from 'vitest'
import { brushWidthProfile } from './PaintbrushTool'

const horizontal = Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 0 }))
const diagonal45 = Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: i * 10 }))

describe('brushWidthProfile', () => {
  it('uniform emits no profile (plain stroke)', () => {
    expect(brushWidthProfile('uniform', 8, horizontal)).toBeNull()
  })

  it('taper thins both ends and keeps the body at full width', () => {
    const profile = brushWidthProfile('taper', 10, horizontal)!
    expect(profile[0]!.width).toBeLessThan(3)
    expect(profile[1]!.width).toBe(10)
    expect(profile[profile.length - 1]!.width).toBeLessThan(3)
  })

  it('calligraphic width follows the stroke direction against the nib', () => {
    // A 45° stroke runs ALONG the nib -> hairline everywhere.
    const along = brushWidthProfile('calligraphic', 10, diagonal45)!
    for (const stop of along) expect(stop.width).toBeLessThan(2)
    // A -45° stroke crosses the nib -> full width everywhere.
    const across = brushWidthProfile(
      'calligraphic',
      10,
      diagonal45.map((p) => ({ x: p.x, y: -p.y })),
    )!
    for (const stop of across) expect(stop.width).toBeGreaterThan(9)
    // Offsets are strictly increasing and end at 1.
    for (let i = 1; i < across.length; i++) {
      expect(across[i]!.offset).toBeGreaterThan(across[i - 1]!.offset)
    }
    expect(across[across.length - 1]!.offset).toBe(1)
  })
})
