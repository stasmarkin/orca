import { vi } from 'vitest'

// Native SVG's generated components import Flow-only native subpaths outside the RN host mocks.
vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Svg: 'Svg',
  Defs: 'Defs',
  G: 'G',
  LinearGradient: 'LinearGradient',
  Path: 'Path',
  Rect: 'Rect',
  Stop: 'Stop'
}))

// The reserved-regions module is iOS-only native code; tests run as a platform without it.
vi.mock('./modules/orca-reserved-regions/src', () => ({ OrcaReservedRegions: null }))
// fork:local-only — upstream suites exercise live app updates; src/app-update/fork-app-updates.test.ts restores the real flag.
vi.mock('../src/shared/fork-app-updates', () => ({ APP_UPDATES_ENABLED: true }))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
