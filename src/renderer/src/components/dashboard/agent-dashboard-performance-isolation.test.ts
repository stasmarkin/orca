import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const rendererRoot = join(__dirname, '../..')

function source(relativePath: string): string {
  return readFileSync(join(rendererRoot, relativePath), 'utf8')
}

describe('agent dashboard performance isolation', () => {
  it('keeps all dashboard feature modules out of the disabled app and sidebar path', () => {
    const backgroundServices = source('app-shell/AppBackgroundServices.tsx')
    const sidebar = source('components/sidebar/index.tsx')
    const nav = source('components/sidebar/SidebarNav.tsx')

    expect(backgroundServices).not.toMatch(/from ['"].*DashboardPopoutBridge['"]/)
    expect(backgroundServices).toContain("import('../components/dashboard/DashboardPopoutBridge')")
    expect(sidebar).not.toMatch(/from ['"].*AgentDashboard(?:Drawer|SidebarHost)['"]/)
    expect(sidebar).toContain("import('./AgentDashboardSidebarHost')")
    expect(nav).not.toContain('useAgentBucketCounts')
    expect(nav).not.toContain('shared/dashboard-snapshot')
    expect(nav).toContain("import('./AgentDashboardSidebarEntry')")
  })

  it('keeps the cross-worktree row pipeline out of the always-mounted worktree viewport', () => {
    // Why: the viewport renders for every user on every launch. Pulling the dashboard's
    // aggregate in here reruns the row pipeline for the whole installation on each
    // agentStatusEpoch bump — see the read-set note on useWorktreeAgentRows.
    const viewport = source(
      'components/sidebar/worktree-list/viewport/VirtualizedWorktreeViewport.tsx'
    )

    expect(viewport).not.toContain('useAgentBucketCounts')
    expect(viewport).not.toContain('build-dashboard-bucket-counts')
    expect(viewport).not.toContain('useDashboardData')
  })
})
