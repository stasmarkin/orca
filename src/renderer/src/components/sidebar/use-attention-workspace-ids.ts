import { useMemo, useRef } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { buildAttentionWorkspaceIds, type AttentionWorkspaceState } from './attention-workspaces'

const EMPTY_ATTENTION_WORKSPACE_IDS: ReadonlySet<string> = new Set()

const EMPTY_STATE: AttentionWorkspaceState = {
  agentStatusByPaneKey: {},
  migrationUnsupportedByPtyId: {},
  tabsByWorktree: {},
  ptyIdsByTabId: {},
  runtimePaneTitlesByTabId: {},
  terminalLayoutsByTabId: {}
}

// Why module scope rather than useShallow: zustand runs the selector on every store write, and
// shallow() over this object allocates on each one just to conclude nothing moved. Six `===`
// against the previous slices allocates nothing on the unchanged path, and the result is a pure
// function of the state so one gate serves every consumer.
let previousState: AttentionWorkspaceState | null = null

/** Test-only: drop the cross-render identity gate so a case starts cold. */
export function resetAttentionWorkspaceIdsForTests(): void {
  previousState = null
}

function selectAttentionWorkspaceState(s: AppState): AttentionWorkspaceState {
  const previous = previousState
  if (
    previous !== null &&
    previous.agentStatusByPaneKey === s.agentStatusByPaneKey &&
    previous.migrationUnsupportedByPtyId === s.migrationUnsupportedByPtyId &&
    previous.tabsByWorktree === s.tabsByWorktree &&
    previous.ptyIdsByTabId === s.ptyIdsByTabId &&
    previous.runtimePaneTitlesByTabId === s.runtimePaneTitlesByTabId &&
    previous.terminalLayoutsByTabId === s.terminalLayoutsByTabId
  ) {
    return previous
  }
  previousState = {
    agentStatusByPaneKey: s.agentStatusByPaneKey,
    migrationUnsupportedByPtyId: s.migrationUnsupportedByPtyId,
    tabsByWorktree: s.tabsByWorktree,
    ptyIdsByTabId: s.ptyIdsByTabId,
    runtimePaneTitlesByTabId: s.runtimePaneTitlesByTabId,
    terminalLayoutsByTabId: s.terminalLayoutsByTabId
  }
  return previousState
}

function idsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const id of a) {
    if (!b.has(id)) {
      return false
    }
  }
  return true
}

/**
 * Workspaces whose agent waits on the user, for the collapsed-group count badge.
 *
 * `enabled` false selects a frozen empty state, so the badge setting's `off` mode subscribes to
 * nothing that agent traffic writes and cannot re-render the sidebar.
 *
 * The returned set keeps its identity while membership holds: agent traffic that leaves the
 * verdict unchanged must not invalidate the memos downstream of it.
 */
export function useAttentionWorkspaceIds(enabled: boolean): ReadonlySet<string> {
  // Why agentStatusEpoch: freshness is time-based, so a row can age out of attention with no
  // slice write at all. The epoch ticks at the stale boundary and re-derives the verdict.
  const epoch = useAppStore((s) => (enabled ? s.agentStatusEpoch : 0))
  const state = useAppStore((s) => (enabled ? selectAttentionWorkspaceState(s) : EMPTY_STATE))
  const lastIdsRef = useRef<ReadonlySet<string>>(EMPTY_ATTENTION_WORKSPACE_IDS)
  return useMemo(() => {
    if (!enabled) {
      return EMPTY_ATTENTION_WORKSPACE_IDS
    }
    // Why Date.now() is read here and not a dep: freshness decay is tracked by the epoch above,
    // matching how the dashboard's counts treat their own generation.
    const ids = buildAttentionWorkspaceIds(state, Date.now())
    const stable = idsEqual(lastIdsRef.current, ids) ? lastIdsRef.current : ids
    lastIdsRef.current = stable
    return stable
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, state, epoch])
}
