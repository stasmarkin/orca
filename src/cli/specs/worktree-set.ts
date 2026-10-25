import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const WORKTREE_SET_COMMAND_SPEC: CommandSpec = {
  path: ['worktree', 'set'],
  summary: 'Update Orca metadata for a worktree or folder workspace',
  usage:
    'orca worktree set --worktree <selector|folder:<folderId>> [--display-name <name>] [--issue <number|null>] [--pr <number|null>] [--linear-issue <identifier-or-url|null>] [--gitlab-issue <number-or-url|null>] [--gitlab-mr <number-or-url|null>] [--comment <text>] [--workspace-status <id>] [--unread|--read] [--pin|--unpin] [--parent-worktree <selector>|--no-parent] [--json]',
  allowedFlags: [
    ...GLOBAL_FLAGS,
    'worktree',
    'display-name',
    'issue',
    'pr',
    'linear-issue',
    'gitlab-issue',
    'gitlab-mr',
    'comment',
    'workspace-status',
    'unread',
    'read',
    'pin',
    'unpin',
    'parent-worktree',
    'no-parent'
  ],
  notes: [
    'Workspace status ids match the board columns (defaults: todo, in-progress, in-review, completed); custom statuses use their configured id.',
    'Pass --linear-issue null to clear the Linear issue link.',
    'Pass --pr null, --gitlab-issue null, or --gitlab-mr null to clear only the matching link.',
    'Each link flag updates its own field and leaves unrelated links unchanged. GitLab URLs must match the stored source project or remote; they cannot select a foreign project.',
    'Pinned workspaces are listed in the sidebar Pinned section; read the current value from the isPinned field of `orca worktree show --json`.',
    'Folder workspaces (folder:<folderId>, or active from a folder with no enclosing worktree) accept --display-name, --comment, --workspace-status, --unread/--read, and --pin/--unpin. Link issues and reviews with orca reference add; --parent-worktree and --no-parent do not apply.',
    'active resolves a folder only for a local CLI; from an SSH terminal pass folder:<folderId>. Folder workspace status ids are not checked against the board columns.'
  ],
  examples: [
    'orca worktree set --worktree active --linear-issue STA-335 --json',
    'orca worktree set --worktree active --linear-issue null --json',
    'orca worktree set --worktree active --workspace-status in-review --unread --json',
    'orca worktree set --worktree active --pin --json',
    'orca worktree set --worktree active --unpin --json',
    'orca worktree set --worktree folder:<folderId> --comment "waiting on review" --json'
  ]
}
