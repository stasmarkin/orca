import { describe, expect, it, vi } from 'vitest'
import type { DaemonAsyncIoHealth } from '../../shared/daemon-async-io-health'
import { createDaemonProcessExit } from './daemon-process-exit'

function harness(checkAsyncIoFresh: () => Promise<DaemonAsyncIoHealth>) {
  const events: string[] = []
  const log = {
    log: vi.fn((event: string) => events.push(event)),
    close: vi.fn(() => events.push('close'))
  }
  const deps = {
    checkAsyncIoFresh: vi.fn(checkAsyncIoFresh),
    exit: vi.fn((code: number) => events.push(`exit:${code}`)),
    kill: vi.fn(() => events.push('kill'))
  }
  return { log, deps, events, processExit: createDaemonProcessExit(log, deps) }
}

const never = (): Promise<DaemonAsyncIoHealth> => new Promise(() => {})

describe('daemon process exit', () => {
  it('exits normally with the requested code when the threadpool is healthy', async () => {
    const h = harness(async () => ({ state: 'healthy', pendingMs: 0 }))
    await h.processExit.exit(1)
    expect(h.events).toEqual(['close', 'exit:1'])
  })

  it('kills itself instead of joining a wedged threadpool, after logging why', async () => {
    const h = harness(async () => ({ state: 'stalled', pendingMs: 5_000 }))
    await h.processExit.exit(0)
    expect(h.events).toEqual(['shutdown-hard-exit', 'close', 'kill'])
    expect(h.log.log).toHaveBeenCalledWith('shutdown-hard-exit', { code: 0, pendingMs: 5_000 })
  })

  it('treats a probe that cannot start as no evidence of a stall', async () => {
    const h = harness(() => Promise.reject(new Error('probe unavailable')))
    await h.processExit.exit(0)
    expect(h.events).toEqual(['close', 'exit:0'])
  })

  it('hard-exits at the deadline without waiting when the primed probe never completed', () => {
    const h = harness(never)
    void h.processExit.prime()
    h.processExit.exitNow(0)
    expect(h.events).toEqual(['shutdown-hard-exit', 'close', 'kill'])
    expect(h.deps.checkAsyncIoFresh).toHaveBeenCalledOnce()
  })

  it('exits normally at the deadline when the primed probe already proved the pool healthy', async () => {
    const h = harness(async () => ({ state: 'healthy', pendingMs: 0 }))
    await h.processExit.prime()
    h.processExit.exitNow(0)
    expect(h.events).toEqual(['close', 'exit:0'])
  })

  it('exits only once when the deadline and the teardown race', async () => {
    const h = harness(async () => ({ state: 'healthy', pendingMs: 0 }))
    const teardown = h.processExit.exit(0)
    const again = h.processExit.exit(0)
    await Promise.all([teardown, again])
    h.processExit.exitNow(0)
    expect(h.events).toEqual(['close', 'exit:0'])
    expect(h.deps.checkAsyncIoFresh).toHaveBeenCalledOnce()
  })
})
