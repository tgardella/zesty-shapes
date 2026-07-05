import { describe, expect, it } from 'vitest'
import {
  acquireDef,
  createDefsRegistry,
  defCount,
  defsToSVG,
  releaseAllForUser,
  releaseDef,
} from './defs'
import type { GradientPaint } from './types'

function makeGradient(overrides: Partial<GradientPaint> = {}): GradientPaint {
  return {
    type: 'gradient',
    gradientType: 'linear',
    stops: [
      { offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { offset: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
    ],
    transform: [1, 0, 0, 1, 0, 0],
    ...overrides,
  }
}

describe('defs registry', () => {
  it('allocates STABLE ids and dedupes identical paints', () => {
    const reg = createDefsRegistry()
    const id1 = acquireDef(reg, makeGradient(), 'node-a')
    const id2 = acquireDef(reg, makeGradient(), 'node-b')
    expect(id1).toBe(id2)
    expect(defCount(reg)).toBe(1)
    // Re-acquiring by the same user is idempotent and keeps the id.
    expect(acquireDef(reg, makeGradient(), 'node-a')).toBe(id1)
  })

  it('distinct paints get distinct defs', () => {
    const reg = createDefsRegistry()
    const id1 = acquireDef(reg, makeGradient(), 'node-a')
    const id2 = acquireDef(reg, makeGradient({ gradientType: 'radial' }), 'node-a')
    expect(id1).not.toBe(id2)
    expect(defCount(reg)).toBe(2)
  })

  it('garbage-collects a def when its LAST user releases', () => {
    const reg = createDefsRegistry()
    const id = acquireDef(reg, makeGradient(), 'node-a')
    acquireDef(reg, makeGradient(), 'node-b')
    releaseDef(reg, id, 'node-a')
    expect(defCount(reg)).toBe(1) // node-b still holds it
    releaseDef(reg, id, 'node-b')
    expect(defCount(reg)).toBe(0)
    // Releasing again is a no-op.
    releaseDef(reg, id, 'node-b')
    expect(defCount(reg)).toBe(0)
  })

  it('releaseAllForUser drops every def a deleted node held', () => {
    const reg = createDefsRegistry()
    acquireDef(reg, makeGradient(), 'node-a')
    acquireDef(reg, makeGradient({ gradientType: 'radial' }), 'node-a')
    acquireDef(reg, makeGradient(), 'node-b')
    releaseAllForUser(reg, 'node-a')
    expect(defCount(reg)).toBe(1) // the shared linear survives via node-b
  })

  it('emits a <defs> block with stops, empty string when unused', () => {
    const reg = createDefsRegistry()
    expect(defsToSVG(reg)).toBe('')
    const id = acquireDef(reg, makeGradient({ gradientType: 'radial' }), 'node-a')
    const svg = defsToSVG(reg)
    expect(svg).toContain(`<radialGradient id="${id}"`)
    expect(svg).toContain('stop-color="rgb(255,255,255)"')
  })
})
