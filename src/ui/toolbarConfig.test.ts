import { describe, expect, it } from 'vitest'
import { displayOrder, groupKeyOf, toolbarSlots } from './toolbarConfig'

const REGISTERED = ['selection', 'pen', 'rectangle', 'ellipse']

describe('displayOrder', () => {
  it('falls back to registration order with an empty config', () => {
    expect(displayOrder({ order: [], hidden: [] }, REGISTERED)).toEqual(REGISTERED)
  })

  it('honors the saved order and appends unknown-to-config tools', () => {
    const order = ['ellipse', 'selection']
    expect(displayOrder({ order, hidden: [] }, REGISTERED)).toEqual([
      'ellipse',
      'selection',
      'pen',
      'rectangle',
    ])
  })

  it('drops config entries for tools that no longer exist', () => {
    const order = ['gone-tool', 'pen']
    expect(displayOrder({ order, hidden: [] }, REGISTERED)).toEqual([
      'pen',
      'selection',
      'rectangle',
      'ellipse',
    ])
  })
})

describe('toolbarSlots (click+hold groups)', () => {
  const IDS = ['selection', 'rectangle', 'ellipse', 'star', 'pen', 'curvature', 'custom-tool']

  it('buckets grouped tools into one slot with the first visible member fronting', () => {
    const slots = toolbarSlots({ order: [], hidden: [], groupCurrent: {} }, IDS)
    const shapes = slots.find((s) => s.key === 'rectangle')!
    expect(shapes.toolIds).toEqual(['rectangle', 'ellipse', 'star'])
    expect(shapes.currentId).toBe('rectangle')
    // Ungrouped tools get singleton slots.
    expect(slots.find((s) => s.key === 'custom-tool')!.toolIds).toEqual(['custom-tool'])
  })

  it('fronts the remembered last-used member', () => {
    const slots = toolbarSlots(
      { order: [], hidden: [], groupCurrent: { rectangle: 'star' } },
      IDS,
    )
    expect(slots.find((s) => s.key === 'rectangle')!.currentId).toBe('star')
  })

  it('hidden members leave the flyout; a fully hidden group has no slot', () => {
    const slots = toolbarSlots(
      { order: [], hidden: ['ellipse', 'pen', 'curvature'], groupCurrent: {} },
      IDS,
    )
    expect(slots.find((s) => s.key === 'rectangle')!.toolIds).toEqual(['rectangle', 'star'])
    expect(slots.find((s) => s.key === 'pen')).toBeUndefined()
  })

  it('falls back to the first visible member when the remembered one is hidden', () => {
    const slots = toolbarSlots(
      { order: [], hidden: ['star'], groupCurrent: { rectangle: 'star' } },
      IDS,
    )
    expect(slots.find((s) => s.key === 'rectangle')!.currentId).toBe('rectangle')
  })

  it('groupKeyOf resolves members and passes unknown ids through', () => {
    expect(groupKeyOf('star')).toBe('rectangle')
    expect(groupKeyOf('curvature')).toBe('pen')
    expect(groupKeyOf('custom-tool')).toBe('custom-tool')
  })
})
