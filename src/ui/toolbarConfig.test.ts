import { describe, expect, it } from 'vitest'
import { displayOrder } from './toolbarConfig'

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
