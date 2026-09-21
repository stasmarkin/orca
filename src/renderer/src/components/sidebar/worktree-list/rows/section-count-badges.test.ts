import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getSectionCountBadges } from './section-workspace-count-badges'

const NO_ATTENTION: ReadonlySet<string> = new Set()

describe('getSectionCountBadges', () => {
  it('shows nothing while the badge is off', () => {
    expect(
      getSectionCountBadges(
        { count: 3, countedWorkspaceIds: ['a', 'b', 'c'] },
        'off',
        new Set(['a'])
      )
    ).toEqual({ total: null, attention: null })
  })

  it('shows only the waiting count in attention mode', () => {
    expect(
      getSectionCountBadges(
        { count: 3, countedWorkspaceIds: ['a', 'b', 'c'] },
        'attention',
        new Set(['a', 'c'])
      )
    ).toEqual({ total: null, attention: 2 })
  })

  it('drops the waiting badge when nothing waits', () => {
    expect(
      getSectionCountBadges(
        { count: 2, countedWorkspaceIds: ['a', 'b'] },
        'attention',
        NO_ATTENTION
      )
    ).toEqual({ total: null, attention: null })
  })

  it('shows the total alongside the waiting count in all mode', () => {
    expect(
      getSectionCountBadges(
        { count: 3, countedWorkspaceIds: ['a', 'b', 'c'] },
        'all',
        new Set(['b'])
      )
    ).toEqual({ total: 3, attention: 1 })
  })

  it('shows nothing for an empty group in any mode', () => {
    expect(
      getSectionCountBadges({ count: 0, countedWorkspaceIds: [] }, 'all', NO_ATTENTION)
    ).toEqual({ total: null, attention: null })
  })

  it('counts a project group s workspaces, not the child projects its count carries', () => {
    // A group of two projects holding five workspaces between them.
    expect(
      getSectionCountBadges(
        { count: 2, countedWorkspaceIds: ['a', 'b', 'c', 'd', 'e'] },
        'all',
        new Set(['d'])
      )
    ).toEqual({ total: 5, attention: 1 })
  })

  it('counts one waiting workspace when a repo on two hosts publishes the same id', () => {
    // STA-4343: worktreeId carries no host, so one repo checked out twice repeats the id.
    expect(
      getSectionCountBadges(
        { count: 2, countedWorkspaceIds: ['wt-1', 'wt-1'] },
        'all',
        new Set(['wt-1'])
      )
    ).toEqual({ total: 2, attention: 1 })
  })

  it('ignores attention workspaces outside the group', () => {
    expect(
      getSectionCountBadges(
        { count: 2, countedWorkspaceIds: ['a', 'b'] },
        'all',
        new Set(['hidden-by-filter', 'archived'])
      )
    ).toEqual({ total: 2, attention: null })
  })

  it('falls back to count when a header carries no workspace ids', () => {
    expect(getSectionCountBadges({ count: 4 }, 'all', new Set(['a']))).toEqual({
      total: 4,
      attention: null
    })
  })
})

describe('collapsed-only badge gate', () => {
  it('derives badges from collapse alone, not from the chevron', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./SectionHeader.tsx', import.meta.url)),
      'utf8'
    )

    const gateStart = source.indexOf('const countBadges =')
    const gate = source.slice(gateStart, source.indexOf('return (', gateStart)).replace(/\s+/g, ' ')

    expect(gate).toContain('isHeaderCollapsed ?')
    // "All" and PR lanes collapse on row click without ever painting a chevron.
    expect(gate).not.toContain('showHeaderCollapseAffordance')
    expect(gate).toContain(
      'getSectionCountBadges(row, ctx.countBadgeMode, ctx.attentionWorkspaceIds)'
    )
  })
})
