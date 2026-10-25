import type { DaemonFileLog } from './daemon-file-log'

export const DAEMON_SHUTDOWN_TIMEOUT_MS = 5_000

/** Force exit if shutdown stalls, including RPC teardown. */
export function createDaemonShutdownDeadline(
  log: Pick<DaemonFileLog, 'log'>,
  exit: () => void
): { start: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    start: () => {
      if (timer) {
        return
      }
      timer = setTimeout(() => {
        log.log('shutdown-error', { message: 'shutdown timeout' })
        exit()
      }, DAEMON_SHUTDOWN_TIMEOUT_MS)
      timer.unref()
    },
    cancel: () => {
      clearTimeout(timer)
      timer = undefined
    }
  }
}
