import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { createDesktopConnectorCloud, type ConnectorCloudStore } from './connector-cloud-install'

const { connectorCloudConstructed } = vi.hoisted(() => ({ connectorCloudConstructed: vi.fn() }))

vi.mock('../orca-profiles/profile-cloud-auth-config', () => ({
  getOrcaCloudAuthConfig: () => ({ configured: true, config: {} })
}))
vi.mock('./connector-cloud', () => ({
  ConnectorCloud: class {
    constructor() {
      connectorCloudConstructed()
    }
  }
}))

describe('fork build Cloud Connector', () => {
  it('is never created, even signed in with experimental connectors on', () => {
    const store = {
      getSettings: () => ({ experimentalConnectors: true }),
      onSettingsChanged: vi.fn()
    } as unknown as ConnectorCloudStore

    const connector = createDesktopConnectorCloud(
      {} as OrcaRuntimeService,
      store,
      '/tmp/orca-user-data',
      () => false
    )

    expect(connector).toBeNull()
    expect(connectorCloudConstructed).not.toHaveBeenCalled()
  })
})
