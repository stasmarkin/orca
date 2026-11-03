import type { DaemonAsyncIoHealth } from '../../shared/daemon-async-io-health'
import { checkDaemonAsyncIo } from './daemon-async-io-probe'
import type { DaemonFileLog } from './daemon-file-log'

type DaemonProcessExitDeps = {
  checkAsyncIoFresh: () => Promise<DaemonAsyncIoHealth>
  exit: (code: number) => void
  kill: () => void
}

const defaultDeps: DaemonProcessExitDeps = {
  checkAsyncIoFresh: () => checkDaemonAsyncIo({ fresh: true }),
  exit: (code) => process.exit(code),
  kill: () => process.kill(process.pid, 'SIGKILL')
}

export type DaemonProcessExit = {
  /** Starts the pool probe early so the verdict is ready within the shutdown budget. */
  prime: () => Promise<void>
  /** Waits for the probe verdict (bounded by the probe timeout), then exits. */
  exit: (code: number) => Promise<void>
  /** No budget left: a probe that has not completed counts as a wedged pool. */
  exitNow: (code?: number) => void
}

/**
 * `process.exit` joins the libuv workers, so a wedged threadpool would hang the exit forever.
 * A wedged pool exits via SIGKILL instead, which also skips `process.on('exit')` handlers.
 */
export function createDaemonProcessExit(
  log: Pick<DaemonFileLog, 'log' | 'close'>,
  deps: DaemonProcessExitDeps = defaultDeps
): DaemonProcessExit {
  let probe: Promise<DaemonAsyncIoHealth | null> | null = null
  let verdict: DaemonAsyncIoHealth | null | undefined
  let exiting = false

  const prime = (): Promise<DaemonAsyncIoHealth | null> => {
    probe ??= deps
      .checkAsyncIoFresh()
      .catch(() => null)
      .then((health) => {
        verdict = health
        return health
      })
    return probe
  }

  const finish = (code: number, health: DaemonAsyncIoHealth | null): void => {
    if (exiting) {
      return
    }
    exiting = true
    if (health?.state === 'stalled') {
      log.log('shutdown-hard-exit', { code, pendingMs: health.pendingMs })
      log.close()
      deps.kill()
      return
    }
    log.close()
    deps.exit(code)
  }

  return {
    prime: async () => {
      await prime()
    },
    exit: async (code) => finish(code, await prime()),
    exitNow: (code = 0) => {
      void prime()
      finish(code, verdict === undefined ? { state: 'stalled', pendingMs: 0 } : verdict)
    }
  }
}
