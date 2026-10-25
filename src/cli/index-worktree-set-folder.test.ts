import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  callMock,
  runtimeClientConstructorMock,
  serveOrcaAppMock,
  getDefaultUserDataPathMock,
  addEnvironmentFromPairingCodeMock,
  listEnvironmentsMock,
  spawnMock
} = vi.hoisted(() => ({
  callMock: vi.fn(),
  runtimeClientConstructorMock: vi.fn(),
  serveOrcaAppMock: vi.fn(),
  getDefaultUserDataPathMock: vi.fn(() => '/tmp/orca-user-data'),
  addEnvironmentFromPairingCodeMock: vi.fn(),
  listEnvironmentsMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('./runtime-client', async () => {
  const { createRuntimeClientModuleMock } = await import('./index-test-harness.js')
  return createRuntimeClientModuleMock({
    callMock,
    runtimeClientConstructorMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock
  })
})

vi.mock('./runtime/environments', () => ({
  addEnvironmentFromPairingCode: addEnvironmentFromPairingCodeMock,
  listEnvironments: listEnvironmentsMock,
  removeEnvironment: vi.fn(),
  resolveEnvironment: vi.fn()
}))

vi.mock('child_process', async () => {
  const { createChildProcessModuleMock } = await import('./index-test-harness.js')
  return createChildProcessModuleMock(spawnMock)
})

import { main } from './index'
import { RuntimeClientError } from './runtime/types'
import { buildWorktree, okFixture, queueFixtures, worktreeListFixture } from './test-fixtures'
import { useWorktreeAwarenessEnvironment } from './index-test-harness'

const SSH_CALLER = {
  ORCA_ORCHESTRATION_COMPATIBILITY_HOST_KIND: 'ssh',
  ORCA_ORCHESTRATION_COMPATIBILITY_HOST_ID: 'host-d',
  ORCA_ORCHESTRATION_COMPATIBILITY_HOST_INCARNATION: 'inc-1',
  ORCA_ORCHESTRATION_COMPATIBILITY_ATTACHMENT: 'att-1'
}

function folderFixture(overrides: Record<string, unknown> = {}) {
  return okFixture('req_folder', {
    folderWorkspace: {
      id: 'f1',
      name: 'Docs',
      folderPath: '/tmp/folder',
      comment: '',
      isPinned: false,
      isUnread: false,
      workspaceStatus: 'todo',
      ...overrides
    }
  })
}

function rejectOnce(code: string, message = code) {
  callMock.mockRejectedValueOnce(new RuntimeClientError(code, message))
}

async function runSet(args: string[], cwd = '/tmp/elsewhere') {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await main(['worktree', 'set', ...args, '--json'], cwd)
  return JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]))
}

function calledMethods(): string[] {
  return callMock.mock.calls.map(([method]) => String(method))
}

describe('orca worktree set for folder workspaces', () => {
  useWorktreeAwarenessEnvironment({
    callMock,
    serveOrcaAppMock,
    getDefaultUserDataPathMock,
    addEnvironmentFromPairingCodeMock,
    listEnvironmentsMock,
    spawnMock
  })

  const priorExitCode = process.exitCode
  afterEach(() => {
    process.exitCode = priorExitCode
    vi.unstubAllEnvs()
  })

  it('maps applicable flags onto folderWorkspace.update', async () => {
    queueFixtures(callMock, folderFixture({ name: 'N', comment: 'C', isUnread: true }))

    const output = await runSet([
      '--worktree',
      'folder:f1',
      '--display-name',
      'N',
      '--comment',
      'C',
      '--workspace-status',
      'in-review',
      '--unread'
    ])

    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock).toHaveBeenCalledWith('folderWorkspace.update', {
      folderWorkspaceId: 'f1',
      updates: {
        name: 'N',
        pendingFirstAgentMessageRename: false,
        firstAgentMessageRenameError: null,
        comment: 'C',
        workspaceStatus: 'in-review',
        isUnread: true
      }
    })
    expect(output.result.folderWorkspace.id).toBe('f1')
    expect(output.result).not.toHaveProperty('worktree')
  })

  it.each([
    [['--worktree', 'id:folder:f1', '--read'], { isUnread: false }],
    [['--worktree', 'folder:f1', '--pin'], { isPinned: true }],
    [['--worktree', 'folder:f1', '--unpin'], { isPinned: false }],
    [['--worktree', 'folder:f1', '--display-name', '', '--comment', ''], {}]
  ])('sends only present updates for %j', async (args, updates) => {
    queueFixtures(callMock, folderFixture())

    await runSet(args)

    expect(callMock).toHaveBeenCalledWith('folderWorkspace.update', {
      folderWorkspaceId: 'f1',
      updates
    })
  })

  it('prints a text summary without --json', async () => {
    queueFixtures(callMock, folderFixture())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await main(['worktree', 'set', '--worktree', 'folder:f1', '--comment', 'x'], '/tmp')

    expect(String(logSpy.mock.calls[0]?.[0])).toContain('id: folder:f1\nname: Docs')
  })

  it.each([
    ['issue', '1'],
    ['pr', '1'],
    ['linear-issue', 'STA-335'],
    ['gitlab-issue', '#42'],
    ['gitlab-mr', '!77']
  ])('rejects --%s on a folder with a reference add hint', async (flag, value) => {
    const output = await runSet(['--worktree', 'folder:f1', `--${flag}`, value])

    expect(callMock).not.toHaveBeenCalled()
    expect(output.error.code).toBe('invalid_argument')
    expect(output.error.message).toContain(
      `--${flag} not supported by \`worktree set\` for folder workspaces`
    )
    expect(output.error.message).toContain('orca reference add --worktree folder:f1 --url')
  })

  it('names every unsupported flag in one error', async () => {
    const output = await runSet(['--worktree', 'folder:f1', '--pr', '1', '--no-parent'])

    expect(callMock).not.toHaveBeenCalled()
    expect(output.error.message).toContain('--pr, --no-parent not supported')
  })

  it('rejects lineage flags without a reference hint', async () => {
    const output = await runSet(['--worktree', 'folder:f1', '--parent-worktree', 'name:x'])

    expect(callMock).not.toHaveBeenCalled()
    expect(output.error.message).toContain('--parent-worktree not supported')
    expect(output.error.message).not.toContain('reference add')
  })

  it.each(['folder:', 'id:folder:'])('rejects %s without an id', async (selector) => {
    const output = await runSet(['--worktree', selector, '--read'])

    expect(callMock).not.toHaveBeenCalled()
    expect(output.error.code).toBe('invalid_argument')
  })

  it('reports an unknown folder id as selector_not_found', async () => {
    queueFixtures(callMock, okFixture('req_folder', { folderWorkspace: null }))

    const output = await runSet(['--worktree', 'folder:f1', '--read'])

    expect(output.error).toMatchObject({
      code: 'selector_not_found',
      message: 'No folder workspace with id f1'
    })
  })

  it('names the version gap when the host lacks folder workspaces', async () => {
    rejectOnce('method_not_found')

    const output = await runSet(['--worktree', 'folder:f1', '--read'])

    expect(output.error).toMatchObject({
      code: 'incompatible_runtime',
      message:
        'This Orca host does not support folder workspaces. Update Orca on the execution host.'
    })
  })

  it('accepts an explicit folder selector from a paired client', async () => {
    queueFixtures(callMock, folderFixture())

    await runSet(['--pairing-code', 'remote-runtime', '--worktree', 'folder:f1', '--comment', 'C'])

    expect(calledMethods()).toEqual(['folderWorkspace.update'])
  })

  describe('active', () => {
    const NOTES = '/tmp/folder/notes'

    function folderCatalog(folders: Record<string, unknown>[]) {
      return [
        okFixture('req_folders', { folderWorkspaces: folders }),
        okFixture('req_groups', {
          groups: [{ id: 'local' }, { id: 'ssh', connectionId: 'ssh-1' }]
        }),
        okFixture('req_repos', { repos: [] })
      ]
    }

    const folder = (id: string, projectGroupId = 'local') => ({
      id,
      folderPath: '/tmp/folder',
      projectGroupId
    })

    it('keeps an enclosing git worktree even inside a folder path', async () => {
      queueFixtures(
        callMock,
        worktreeListFixture([buildWorktree('/tmp/folder/repo', 'main')]),
        okFixture('req_set', { worktree: { id: 'repo::/tmp/folder/repo' } })
      )

      await runSet(['--worktree', 'active', '--read'], '/tmp/folder/repo/src')

      expect(calledMethods()).toEqual(['worktree.list', 'worktree.set'])
    })

    it('falls back to the innermost live native folder when no worktree contains cwd', async () => {
      queueFixtures(
        callMock,
        worktreeListFixture([]),
        ...folderCatalog([
          folder('f1'),
          { ...folder('archived'), isArchived: true },
          { ...folder('outer'), folderPath: '/tmp' }
        ]),
        folderFixture()
      )

      await runSet(['--worktree', 'current', '--read'], NOTES)

      expect(callMock).toHaveBeenLastCalledWith('folderWorkspace.update', {
        folderWorkspaceId: 'f1',
        updates: { isUnread: false }
      })
    })

    it('breaks a same-path tie with the calling folder terminal', async () => {
      vi.stubEnv('ORCA_WORKSPACE_ID', 'folder:f2')
      queueFixtures(
        callMock,
        worktreeListFixture([]),
        ...folderCatalog([folder('f1'), folder('f2')]),
        folderFixture({ id: 'f2' })
      )

      await runSet(['--worktree', 'active', '--read'], NOTES)

      expect(callMock).toHaveBeenLastCalledWith('folderWorkspace.update', {
        folderWorkspaceId: 'f2',
        updates: { isUnread: false }
      })
    })

    it('refuses a same-path tie it cannot break', async () => {
      queueFixtures(
        callMock,
        worktreeListFixture([]),
        ...folderCatalog([folder('f1'), folder('f2')])
      )

      const output = await runSet(['--worktree', 'active', '--read'], NOTES)

      expect(output.error.code).toBe('selector_ambiguous')
      expect(output.error.message).toContain('folder:f1, folder:f2')
      expect(calledMethods()).not.toContain('folderWorkspace.update')
    })

    it('treats a trailing slash as the same path, not a deeper folder', async () => {
      queueFixtures(
        callMock,
        worktreeListFixture([]),
        ...folderCatalog([folder('f1'), { ...folder('f2'), folderPath: '/tmp/folder/' }])
      )

      const output = await runSet(['--worktree', 'active', '--read'], NOTES)

      expect(output.error.code).toBe('selector_ambiguous')
      expect(calledMethods()).not.toContain('folderWorkspace.update')
    })

    it('ignores folders that live on an SSH host', async () => {
      queueFixtures(callMock, worktreeListFixture([]), ...folderCatalog([folder('remote', 'ssh')]))

      const output = await runSet(['--worktree', 'active', '--read'], NOTES)

      expect(output.error.code).toBe('selector_not_found')
      expect(calledMethods()).not.toContain('folderWorkspace.update')
    })

    it('keeps the git error when the host has no folder catalog', async () => {
      queueFixtures(callMock, worktreeListFixture([]))
      rejectOnce('method_not_found')

      const output = await runSet(['--worktree', 'active', '--read'], NOTES)

      expect(output.error.code).toBe('selector_not_found')
      expect(output.error.message).toContain(
        'No Orca-managed worktree contains the current directory'
      )
    })

    it('never consults folders from an SSH caller', async () => {
      for (const [key, value] of Object.entries(SSH_CALLER)) {
        vi.stubEnv(key, value)
      }
      queueFixtures(callMock, worktreeListFixture([]))

      const output = await runSet(['--worktree', 'active', '--read'], NOTES)

      expect(output.error.code).toBe('selector_not_found')
      expect(calledMethods()).toEqual(['worktree.list'])
    })

    it('skips the folder fallback when a flag cannot apply to folders', async () => {
      queueFixtures(callMock, worktreeListFixture([]))

      const output = await runSet(['--worktree', 'active', '--pr', '1'], NOTES)

      expect(output.error.code).toBe('selector_not_found')
      expect(calledMethods()).toEqual(['worktree.list'])
    })

    it('is still rejected on a paired client', async () => {
      const output = await runSet(['--pairing-code', 'remote-runtime', '--worktree', 'active'])

      expect(callMock).not.toHaveBeenCalled()
      expect(output.error.message).toContain('active is a local cwd shortcut')
    })
  })
})
