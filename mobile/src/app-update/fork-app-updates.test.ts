import { afterEach, describe, expect, it, vi } from 'vitest'

const { fetchSpy } = vi.hoisted(() => ({ fetchSpy: vi.fn() }))

// Overrides the vitest.setup mock that turns updates back on for upstream suites.
vi.mock('../../../src/shared/fork-app-updates', async (importOriginal) => importOriginal())
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: { addEventListener: () => ({ remove: () => {} }) }
}))
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '0.0.40' } } }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }))
vi.mock('expo-linking', () => ({ openURL: async () => {} }))
vi.mock('../storage/app-update-preferences', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadAppUpdatePreferences: async () => ({
    lastCheckedAt: 1,
    latest: { version: '0.0.50', url: 'https://example.invalid/release' },
    dismissedVersion: null
  }),
  saveAppUpdateCheck: async () => {},
  saveDismissedAppUpdateVersion: async () => {}
}))

describe('fork build mobile app updates', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('never checks a release source and hides a previously stored release', async () => {
    vi.stubGlobal('fetch', fetchSpy)
    const { appUpdateChecker } = await import('./app-update-runtime')

    const stop = appUpdateChecker.start()
    await expect(appUpdateChecker.checkNow()).resolves.toBe('failed')
    await vi.waitFor(() => expect(appUpdateChecker.getSnapshot().lastCheckedAt).toBe(1))
    stop()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(appUpdateChecker.getSnapshot().available).toBeNull()
  })
})
