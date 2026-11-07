import type { getReleaseDownloadUrl } from './releases/updater-release-readiness'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadUpdaterModule, warmUpdaterModule } from './testing/updater-test-module-loader'
import { updaterMainWindow } from './testing/updater-test-main-window'

const {
  appMock,
  autoUpdaterMock,
  powerMonitorOnMock,
  fetchNudgeMock,
  fetchNewerReleaseTagsMock,
  chooseLocalBuildMock,
  moduleFactories,
  resetUpdaterMocks
} = await vi.hoisted(async () =>
  (await import('./testing/updater-test-harness')).createUpdaterMocks()
)

// Overrides the unit-setup mock that turns updates back on for upstream suites.
vi.mock('../../shared/fork-app-updates', async (importOriginal) => importOriginal())
vi.mock('electron', () => moduleFactories.electron())
vi.mock('electron-updater', () => moduleFactories.electronUpdater())
vi.mock('./electron-updater-loader', () => moduleFactories.electronUpdaterLoader())
vi.mock('../ipc/pty/kill-all', () => moduleFactories.ptyKillAll())
vi.mock('./linux-package/linux-update-package-type', () => moduleFactories.linuxUpdatePackageType())
vi.mock('./updater-lifecycle-diagnostics', () => moduleFactories.updaterLifecycleDiagnostics())
vi.mock('./releases/updater-changelog', () => moduleFactories.updaterChangelog())
vi.mock('./nudges/nudge-campaign', () => moduleFactories.updaterNudge())
vi.mock('./update-install-exit-watchdog', () => moduleFactories.updateInstallExitWatchdog())
vi.mock('./releases/updater-prerelease-feed', () => moduleFactories.updaterPrereleaseFeed())
vi.mock('./releases/updater-release-readiness', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getReleaseDownloadUrl: (
    await vi.importMock<{
      getReleaseDownloadUrl: typeof getReleaseDownloadUrl
    }>('./releases/updater-prerelease-feed')
  ).getReleaseDownloadUrl
}))
vi.mock('../local-builds/local-build-switch', () => moduleFactories.localBuildSwitch())
vi.mock('../local-builds/local-build-feed-server', () => moduleFactories.localBuildFeedServer())

warmUpdaterModule()

describe('fork build updater', () => {
  beforeEach(() => {
    resetUpdaterMocks()
    vi.useFakeTimers()
    appMock.isPackaged = true
  })

  it('never configures the release feed or checks it, even after a day', async () => {
    const { setupAutoUpdater } = await loadUpdaterModule()

    setupAutoUpdater(updaterMainWindow(vi.fn()), { getLastUpdateCheckAt: () => null })
    await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000)

    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled()
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(fetchNudgeMock).not.toHaveBeenCalled()
    expect(powerMonitorOnMock).not.toHaveBeenCalled()
  })

  it('ignores background, manual, prerelease, pinned and local-build checks', async () => {
    const { setupAutoUpdater, checkForUpdates, checkForUpdatesFromMenu, getUpdateStatus } =
      await loadUpdaterModule()
    setupAutoUpdater(updaterMainWindow(vi.fn()))

    checkForUpdates()
    checkForUpdatesFromMenu()
    checkForUpdatesFromMenu({ includePrerelease: true })
    checkForUpdatesFromMenu({ channel: 'rc', targetTag: 'v9.9.9-rc.1' })
    checkForUpdatesFromMenu({ localBuild: true })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled()
    expect(fetchNewerReleaseTagsMock).not.toHaveBeenCalled()
    expect(chooseLocalBuildMock).not.toHaveBeenCalled()
    expect(getUpdateStatus()).toEqual({ state: 'idle' })
  })

  it('lists no release builds', async () => {
    const { listAvailableReleaseBuilds } = await loadUpdaterModule()

    await expect(listAvailableReleaseBuilds('stable')).resolves.toEqual([])
  })
})
