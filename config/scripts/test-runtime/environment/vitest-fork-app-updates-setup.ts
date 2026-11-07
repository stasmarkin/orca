// fork:local-only — upstream updater suites exercise the live updater; fork-app-updates.test.ts restores the real flag.
import { vi } from 'vitest'

vi.mock('../../../../src/shared/fork-app-updates', () => ({ APP_UPDATES_ENABLED: true }))
