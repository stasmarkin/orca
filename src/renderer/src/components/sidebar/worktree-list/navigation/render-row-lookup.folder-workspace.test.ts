import { describe, expect, it } from 'vitest'
import type { FolderWorkspace } from '../../../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import { folderWorkspaceKey } from '../../../../../../shared/workspace-scope'
import {
  PINNED_GROUP_KEY,
  getProjectGroupHeaderKey
} from '../../../../../../shared/sidebar-list/group-keys'
import { buildFolderWorkspaceRow } from '../../../../../../shared/sidebar-list/row-builders'
import type { RenderRow } from '../listing/render-row'
import {
  findPreferredRenderRowIndexForWorktree,
  findPreferredRenderRowIndexForWorktreeIdentity
} from './render-row-lookup'

const FOLDER_WORKSPACE: FolderWorkspace = {
  id: 'fw-1',
  projectGroupId: 'group-1',
  name: 'Folder workspace',
  folderPath: '/tmp/parent',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 1,
  lastActivityAt: 1,
  createdAt: 1,
  updatedAt: 1
}

const PROJECT_GROUP: ProjectGroup = {
  id: 'group-1',
  name: 'Group',
  parentPath: '/tmp/parent',
  parentGroupId: null,
  createdFrom: 'folder-scan',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}

const GROUP_SECTION_KEY = getProjectGroupHeaderKey(PROJECT_GROUP.id)
const WORKSPACE_ID = folderWorkspaceKey(FOLDER_WORKSPACE.id)

// Built through the real constructor so fixtures cannot drift from emitted keys.
function folderRow(sectionKey: string, folderWorkspace = FOLDER_WORKSPACE): RenderRow {
  return buildFolderWorkspaceRow({ folderWorkspace, projectGroup: PROJECT_GROUP }, sectionKey, 0)
}

describe('host-qualified reveal lookup finds folder workspaces', () => {
  it('returns the folder row index instead of -1', () => {
    // Current-workspace reveals carry a host; folder rows must be reachable by that qualified lookup.
    const index = findPreferredRenderRowIndexForWorktreeIdentity(
      [folderRow(GROUP_SECTION_KEY)],
      { id: WORKSPACE_ID, hostId: undefined },
      'single-location'
    )

    expect(index).toBe(0)
  })

  it('does not match a different folder workspace', () => {
    expect(
      findPreferredRenderRowIndexForWorktreeIdentity(
        [folderRow(GROUP_SECTION_KEY, { ...FOLDER_WORKSPACE, id: 'other' })],
        { id: WORKSPACE_ID, hostId: undefined },
        'single-location'
      )
    ).toBe(-1)
  })

  it.each([
    ['local', 0],
    ['runtime:env', 1],
    [undefined, 0],
    ['runtime:missing', -1]
  ] as const)('matches the folder row for host %s', (hostId, expectedIndex) => {
    const rows = (['local', 'runtime:env'] as const).map((executionHostId) =>
      folderRow(GROUP_SECTION_KEY, { ...FOLDER_WORKSPACE, executionHostId })
    )

    expect(
      findPreferredRenderRowIndexForWorktreeIdentity(
        rows,
        { id: WORKSPACE_ID, hostId },
        'single-location'
      )
    ).toBe(expectedIndex)
  })

  it('still lands on the Pinned copy when it is the only one rendered', () => {
    expect(
      findPreferredRenderRowIndexForWorktreeIdentity(
        [folderRow(PINNED_GROUP_KEY, { ...FOLDER_WORKSPACE, isPinned: true })],
        { id: WORKSPACE_ID, hostId: undefined },
        'single-location'
      )
    ).toBe(0)
  })
})

describe('pinned folder workspace duplicates resolve to one preferred row', () => {
  const pinned: FolderWorkspace = { ...FOLDER_WORKSPACE, isPinned: true }
  const duplicatedRows = [folderRow(PINNED_GROUP_KEY, pinned), folderRow(GROUP_SECTION_KEY, pinned)]

  it('prefers the natural copy over the pinned duplicate by identity', () => {
    expect(
      findPreferredRenderRowIndexForWorktreeIdentity(
        duplicatedRows,
        { id: WORKSPACE_ID, hostId: undefined },
        'duplicate-in-groups'
      )
    ).toBe(1)
  })

  it('prefers the natural copy over the pinned duplicate by id', () => {
    expect(
      findPreferredRenderRowIndexForWorktree(duplicatedRows, WORKSPACE_ID, 'duplicate-in-groups')
    ).toBe(1)
  })

  it('falls back to the pinned copy when the natural copy is collapsed away', () => {
    expect(
      findPreferredRenderRowIndexForWorktree(
        [folderRow(PINNED_GROUP_KEY, pinned)],
        WORKSPACE_ID,
        'duplicate-in-groups'
      )
    ).toBe(0)
  })
})
