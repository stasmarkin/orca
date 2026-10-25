import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, read, rmSync, stat, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as pty from 'node-pty'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadNodePtyForTests } from '../orcad/orcad-node-slot-fixture'

const describePosix = process.platform === 'win32' ? describe.skip : describe

// A daemon whose libuv threadpool stopped taking work kept streaming output but lost all input.
describePosix('PTY input independent of the libuv threadpool', () => {
  let nodePty: typeof pty
  let cleanup: (() => void) | null = null
  beforeAll(async () => {
    nodePty = await loadNodePtyForTests()
  })
  afterEach(() => {
    cleanup?.()
    cleanup = null
  })

  /** Parks every pool worker on a FIFO read; the returned release lets them all finish. */
  function wedgeThreadpool(root: string): { poolBusy: () => boolean; release: () => void } {
    const fifo = join(root, 'wedge.fifo')
    execFileSync('mkfifo', [fifo])
    // O_RDWR keeps open() from blocking and keeps reads blocked: a writer always exists.
    const fd = openSync(fifo, 'r+')
    const workers = Number(process.env.UV_THREADPOOL_SIZE) || 4
    for (let i = 0; i < workers; i++) {
      read(fd, Buffer.alloc(1), 0, 1, null, () => {})
    }
    let statDone = false
    stat(root, () => {
      statDone = true
    })
    return {
      poolBusy: () => !statDone,
      release: () => {
        writeSync(fd, Buffer.alloc(workers))
        closeSync(fd)
      }
    }
  }

  it('still delivers keystrokes to the PTY', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-pool-wedge-'))
    const child = nodePty.spawn('/bin/cat', [], {
      cwd: root,
      cols: 80,
      rows: 24,
      env: { TERM: 'xterm-256color', PATH: '/usr/bin:/bin' }
    })
    let output = ''
    child.onData((data) => {
      output += data
    })
    const pool = wedgeThreadpool(root)
    cleanup = () => {
      pool.release()
      child.kill('SIGKILL')
      rmSync(root, { recursive: true, force: true })
    }

    child.write('typed-while-wedged\r')

    // `cat` echoes the line back only after the PTY actually received it.
    await vi.waitFor(() => expect(output).toContain('typed-while-wedged'), { timeout: 3000 })
    expect(pool.poolBusy(), 'pool stayed wedged while input was delivered').toBe(true)
  })

  it('keeps the event loop free when a child stops reading a large paste', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orca-pty-backpressure-'))
    const child = nodePty.spawn('/bin/sleep', ['30'], {
      cwd: root,
      cols: 80,
      rows: 24,
      env: { PATH: '/usr/bin:/bin' }
    })
    cleanup = () => {
      child.kill('SIGKILL')
      rmSync(root, { recursive: true, force: true })
    }

    // Far beyond any PTY input buffer: a blocking master would park the daemon thread here.
    child.write('x'.repeat(4 * 1024 * 1024))

    let timerFired = false
    setTimeout(() => {
      timerFired = true
    }, 0)
    await vi.waitFor(() => expect(timerFired).toBe(true), { timeout: 3000 })
  })
})
