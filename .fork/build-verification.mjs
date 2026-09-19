// Typechecks a rebuilt fork main before it is published. Merging branches that each typecheck alone
// can still produce a tree that does not, and fork main is what `just install` builds from.
import { execFileSync } from 'node:child_process'

const TYPECHECK_SCRIPT = 'config/scripts/run-typecheck-projects-in-parallel.mjs'

/**
 * Runs node directly rather than `pnpm run typecheck`: pnpm would run its install lifecycle first,
 * and through the linked node_modules that rebuilds native modules in the real checkout.
 * @param {string} cwd
 */
export function typecheckTree(cwd) {
  try {
    execFileSync('node', [TYPECHECK_SCRIPT], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return null
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter((part) => typeof part === 'string' && part !== '')
      .join('\n')
    return output.trim() || error.message
  }
}
