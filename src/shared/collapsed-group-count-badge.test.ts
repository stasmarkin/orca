import { describe, expect, it } from 'vitest'
import {
  collapsedGroupCountBadgeNeedsAttention,
  DEFAULT_COLLAPSED_GROUP_COUNT_BADGE_MODE,
  resolveCollapsedGroupCountBadgeMode
} from './collapsed-group-count-badge'

describe('resolveCollapsedGroupCountBadgeMode', () => {
  it('defaults to attention for profiles predating the setting', () => {
    expect(resolveCollapsedGroupCountBadgeMode(undefined)).toBe('attention')
    expect(resolveCollapsedGroupCountBadgeMode(null)).toBe('attention')
    expect(resolveCollapsedGroupCountBadgeMode({})).toBe('attention')
  })

  it('ships attention as the app default', () => {
    expect(DEFAULT_COLLAPSED_GROUP_COUNT_BADGE_MODE).toBe('attention')
  })

  it('keeps every valid mode', () => {
    expect(resolveCollapsedGroupCountBadgeMode({ collapsedGroupCountBadge: 'off' })).toBe('off')
    expect(resolveCollapsedGroupCountBadgeMode({ collapsedGroupCountBadge: 'all' })).toBe('all')
  })

  it('falls back for a value outside the union', () => {
    expect(
      resolveCollapsedGroupCountBadgeMode({
        collapsedGroupCountBadge: 'everything' as never
      })
    ).toBe('attention')
  })

  it('needs the attention tally in every mode but off', () => {
    expect(collapsedGroupCountBadgeNeedsAttention('off')).toBe(false)
    expect(collapsedGroupCountBadgeNeedsAttention('attention')).toBe(true)
    expect(collapsedGroupCountBadgeNeedsAttention('all')).toBe(true)
  })
})
