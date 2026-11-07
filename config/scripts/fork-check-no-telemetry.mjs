#!/usr/bin/env node
// Fork-only gate: fails when an upstream merge brings back telemetry, vendor Relay, push, Cloud Connector or auto-update.
// Offline and deterministic. Usage: node config/scripts/fork-check-no-telemetry.mjs [--root <checkout>]

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

const SCRIPT_REL = 'config/scripts/fork-check-no-telemetry.mjs'

// Analytics, crash-reporting, RUM, remote-flag and exporter SDKs. Matched against package names.
const DENIED_PACKAGES = [
  /^posthog(-.+)?$/,
  /^@posthog\//,
  /^@sentry\//,
  /^sentry-/,
  /^raven(-js)?$/,
  /^@amplitude\//,
  /^amplitude-js$/,
  /^mixpanel(-.+)?$/,
  /^@segment\//,
  /^analytics-node$/,
  /^@rudderstack\//,
  /^@datadog\//,
  /^dd-trace$/,
  /^@statsig\//,
  /^statsig-/,
  /^@bugsnag\//,
  /^bugsnag(-.+)?$/,
  /^@rollbar\//,
  /^rollbar$/,
  /^@honeybadger-io\//,
  /^honeybadger(-.+)?$/,
  /^logrocket(-.+)?$/,
  /^@opentelemetry\/(exporter-|sdk-|auto-instrumentations)/,
  /^newrelic$/,
  /^@newrelic\//,
  /^applicationinsights$/,
  /^@microsoft\/applicationinsights/,
  /^appcenter(-.+)?$/,
  /^@react-native-firebase\/(analytics|crashlytics|perf)$/,
  /^@launchdarkly\//,
  /^launchdarkly-/,
  /^@growthbook\//,
  /^@vercel\/(analytics|speed-insights)$/,
  /^@fullstory\//,
  /^@hotjar\//,
  /^@aptabase\//,
  /^@elastic\/apm-/,
  /^elastic-apm-node$/,
  /^@grafana\/faro-/,
  /^@embrace-io\//,
  /^@instabug\//,
  /^instabug-/,
  /^raygun/,
  /^countly-/,
  /^plausible-tracker$/,
  /^expo-insights$/
]

// Known denied packages that stay installed but cannot transmit; each needs a reason and an enforcing check below.
const ALLOWED_PACKAGES = new Map([
  [
    'posthog-node',
    'only transport for main telemetry; dead while TELEMETRY_ENABLED is false (checked)'
  ],
  ['@posthog/core', 'transitive dependency of posthog-node'],
  ['@posthog/types', 'transitive dependency of posthog-node']
])

// Telemetry hosts plus the vendor's phone Relay, push gateway, Cloud Connector and release/update feeds.
const DENIED_HOSTS = [
  /\b[a-z0-9.-]*posthog\.com\b/,
  /\b[a-z0-9.-]*sentry\.io\b/,
  /\bingest\.[a-z0-9.-]*sentry\b/,
  /\b[a-z0-9.-]*amplitude\.com\b/,
  /\b[a-z0-9.-]*mixpanel\.com\b/,
  /\b(api|cdn|events)\.segment\.(io|com)\b/,
  /\b[a-z0-9.-]*datadoghq\.(com|eu)\b/,
  /\bbrowser-intake-[a-z0-9.-]+/,
  /\b[a-z0-9.-]*statsig(api)?\.(com|io)\b/,
  /\bfeaturegates\.org\b/,
  /\b[a-z0-9.-]*bugsnag\.com\b/,
  /\b[a-z0-9.-]*rollbar\.com\b/,
  /\b[a-z0-9.-]*honeybadger\.io\b/,
  /\b[a-z0-9.-]*logrocket\.(com|io)\b/,
  /\blr-ingest\.[a-z]+\b/,
  /\b[a-z0-9.-]*nr-data\.net\b/,
  /\bdc\.services\.visualstudio\.com\b/,
  /\b[a-z0-9.-]*appcenter\.ms\b/,
  /\b[a-z0-9.-]*launchdarkly\.com\b/,
  /\b[a-z0-9.-]*growthbook\.io\b/,
  /\bplausible\.io\b/,
  /\b[a-z0-9.-]*hotjar\.com\b/,
  /\b[a-z0-9.-]*fullstory\.com\b/,
  /\bapp-measurement\.com\b/,
  /\bfirebaselogging[a-z-]*\.googleapis\.com\b/,
  /\brelay(-[a-z0-9]+)?\.onorca\.dev\b/,
  /\bpush\.onorca\.dev\b/,
  /\bconnector\.onorca\.dev\b/,
  /\bonorca\.dev\/whats-new\b/,
  /\bgithub\.com\/stablyai\/orca\/releases(\.atom|\/latest\/download|\/latest|\/download)\b/,
  /\bapi\.github\.com\/repos\/[^'"`\s]*\/releases\b/,
  /\b(telemetry|analytics|metrics|ingest|events|tracking|crash|errors|flags|experiments)[a-z0-9-]*\.(onorca\.dev|orca\.dev|stably\.ai|stablyai\.com)\b/
]

const UPDATER_WHY =
  'desktop updater; setup, checks and build listing return early while APP_UPDATES_ENABLED is false'

// file → the only denied hosts it may name, and why they cannot be contacted in this fork.
const ALLOWED_HOST_FILES = new Map([
  [
    'src/main/telemetry/posthog-transport.ts',
    {
      hosts: /^us\.i\.posthog\.com$/,
      why: 'PostHog transport; dead while TELEMETRY_ENABLED is false'
    }
  ],
  [
    'src/main/orca-profiles/profile-cloud-auth-config.ts',
    {
      hosts: /^relay\.onorca\.dev$/,
      why: 'Relay director default in shared cloud-auth config; the Relay service is never started'
    }
  ],
  [
    'src/main/runtime/push/push-gateway-origin.ts',
    {
      hosts: /^push\.onorca\.dev$/,
      why: 'push gateway default; DesktopPushService.create returns null'
    }
  ],
  [
    'src/shared/remote-runtime/relay/mobile-relay-pairing-fixtures.ts',
    { hosts: /^relay(-c\d+)?\.onorca\.dev$/, why: 'test fixture data, never contacted' }
  ],
  [
    'mobile/src/transport/mobile-endpoint-supervisor-test-fakes.ts',
    { hosts: /^relay(-c\d+)?\.onorca\.dev$/, why: 'test fakes, never contacted' }
  ],
  [
    'src/main/connector-cloud/connector-origin.ts',
    {
      hosts: /^connector\.onorca\.dev$/,
      why: 'Cloud Connector default; createDesktopConnectorCloud returns null'
    }
  ],
  [
    'src/main/updater/lifecycle/updater-setup.ts',
    { hosts: /^github\.com\/stablyai\/orca\/releases\/latest\/download$/, why: UPDATER_WHY }
  ],
  [
    'src/main/updater/releases/updater-prerelease-feed.ts',
    { hosts: /^github\.com\/stablyai\/orca\/releases(\.atom|\/latest)$/, why: UPDATER_WHY }
  ],
  [
    'src/main/updater/releases/updater-release-readiness.ts',
    { hosts: /^github\.com\/stablyai\/orca\/releases\/download$/, why: UPDATER_WHY }
  ],
  [
    'src/main/updater/releases/updater-release-builds.ts',
    { hosts: /^api\.github\.com\/repos\/\$\{repo\}\/releases$/, why: UPDATER_WHY }
  ],
  [
    'src/main/updater/nudges/nudge-campaign.ts',
    { hosts: /^onorca\.dev\/whats-new$/, why: UPDATER_WHY }
  ],
  [
    'src/main/updater/releases/updater-changelog.ts',
    { hosts: /^onorca\.dev\/whats-new$/, why: UPDATER_WHY }
  ],
  [
    'src/main/updater/testing/updater-test-harness.ts',
    {
      hosts: /^github\.com\/stablyai\/orca\/releases\/download$/,
      why: 'test harness, never contacted'
    }
  ],
  [
    'mobile/src/app-update/fixtures/github-release-mobile-android-v0.0.50.json',
    {
      hosts:
        /^(github\.com\/stablyai\/orca\/releases\/download|api\.github\.com\/repos\/stablyai\/orca\/releases)$/,
      why: 'test fixture data, never contacted'
    }
  ]
])

// Each kill switch is a source invariant; a merge that rewrites the surrounding code must fail here, not silently re-enable.
const KILL_SWITCHES = [
  {
    file: 'src/main/telemetry/client.ts',
    mustMatch: /^const TELEMETRY_ENABLED = false$/m,
    what: 'main telemetry flag must be false (covers renderer IPC, daemon, orcad, CLI events)'
  },
  {
    file: 'src/main/runtime/rpc/server/runtime-rpc-mobile-pairing.ts',
    mustMatch:
      /async createMobilePairingOffer\(requested: \{[^}]*\}\): Promise<MobilePairingOffer> \{\s*\/\/ fork:local-only[^\n]*\n\s*const args = \{ \.\.\.requested, connectionMode: 'local-only' as const \}/,
    what: 'every mobile pairing offer must be forced LAN-only'
  },
  {
    file: 'src/renderer/src/components/mobile/use-mobile-pairing-connection-mode.ts',
    mustMatch: /return useState<MobilePairingConnectionMode>\('local-only'\)/,
    what: 'pairing UI must always resolve to LAN mode'
  },
  {
    file: 'src/renderer/src/components/settings/mobile/pairing/MobilePairingConnectionOptions.tsx',
    mustMatch: /^\s*const relayUnavailable = true$/m,
    what: 'Relay option must stay disabled in the pairing picker'
  },
  {
    file: 'src/main/runtime/push/desktop-push-service.ts',
    mustMatch:
      /static create\(_options: DesktopPushServiceOptions\): DesktopPushService \| null \{\s*\/\/ fork:local-only[^\n]*\n\s*return null\s*\}/,
    what: 'vendor push gateway must never be used (desktop and orcad)'
  },
  {
    file: 'src/shared/mobile-runtime-capabilities.ts',
    mustMatch: /MOBILE_RUNTIME_CAPABILITIES = \[[^\]]*\/\/ fork:local-only/,
    mustNotMatch:
      /MOBILE_RUNTIME_CAPABILITIES = \[[^\]]*NOTIFICATIONS_REMOTE_PUSH_RUNTIME_CAPABILITY/,
    what: 'hosts must not advertise remote push, or phones drop LAN-delivered notifications'
  },
  {
    file: 'src/shared/fork-app-updates.ts',
    mustMatch: /^export const APP_UPDATES_ENABLED = false$/m,
    what: 'desktop auto-update flag must be false; the fork updates through its own build'
  },
  {
    file: 'src/main/updater/lifecycle/updater-setup.ts',
    mustMatch: /if \(!app\.isPackaged \|\| !APP_UPDATES_ENABLED\) \{\s*return\s*\}/,
    what: 'updater setup must not configure the feed, schedule checks or fetch nudges'
  },
  {
    file: 'src/main/updater/lifecycle/updater-setup.ts',
    mustMatch: /Promise<ReleaseBuild\[\]> \{\s*if \(!APP_UPDATES_ENABLED\) \{\s*return \[\]\s*\}/,
    what: 'release build listing must not query GitHub'
  },
  {
    file: 'src/main/updater/lifecycle/updater-scheduling.ts',
    mustMatch: /\): boolean \{\s*if \(!APP_UPDATES_ENABLED\) \{\s*return false\s*\}/,
    what: 'background update checks must never launch'
  },
  {
    file: 'src/main/updater/lifecycle/updater-menu-checks.ts',
    mustMatch:
      /checkForUpdatesFromMenu\(options\?: UpdateCheckOptions\): void \{\s*if \(!APP_UPDATES_ENABLED\) \{\s*return\s*\}/,
    what: 'manual, pinned and local-build update checks must not reach the feed'
  },
  {
    file: 'src/main/connector-cloud/connector-cloud-install.ts',
    mustMatch: /^const CONNECTOR_CLOUD_ENABLED = false$/m,
    what: 'Cloud Connector flag must be false'
  },
  {
    file: 'src/main/connector-cloud/connector-cloud-install.ts',
    mustMatch:
      /\): ConnectorCloud \| null \{\s*\/\/ fork:local-only[^\n]*\n\s*if \(!CONNECTOR_CLOUD_ENABLED\) \{\s*return null\s*\}/,
    what: 'desktop Cloud Connector must never be created (no connector.onorca.dev, no cloud commands)'
  }
]

// Call sites that would start a vendor channel; only their own definitions may mention them.
const FORBIDDEN_CALLS = [
  {
    re: /\bstartDesktopRelayService\s*\(/,
    allowedIn: ['src/main/startup/main-process-relay-startup.ts']
  },
  {
    re: /\bnew DesktopRelayService\s*\(/,
    allowedIn: ['src/main/startup/main-process-relay-startup.ts']
  },
  {
    re: /\bcreateDesktopRelayServiceInstaller\s*\(/,
    allowedIn: [
      'src/main/startup/main-process-relay-startup.ts',
      'src/main/runtime/mobile-cloud-relay/desktop-relay-service-installer.ts'
    ]
  },
  {
    re: /\bRelaySessionBroker\.connect\s*\(/,
    allowedIn: ['src/main/runtime/mobile-cloud-relay/desktop-relay-service.ts']
  },
  { re: /\bnew PushGatewayClient\s*\(/, allowedIn: [] },
  {
    re: /\bnew ConnectorCloud\s*\(/,
    allowedIn: ['src/main/connector-cloud/connector-cloud-install.ts']
  },
  { re: /\bnew DesktopPushService\s*\(/, allowedIn: [] }
]

const SCAN_ROOTS = ['src', 'mobile']
const SKIP_DIRS = new Set([
  'node_modules',
  'ios',
  'android',
  '.expo',
  'dist',
  'out',
  'build',
  'Pods',
  '.git'
])
const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|html)$/
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/
const PACKAGE_JSON_SKIP_ROOTS = ['cloud/', 'docs/', 'config/audit-tools/']
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

function parseRoot(argv) {
  const i = argv.indexOf('--root')
  if (i === -1) {
    return resolve(import.meta.dirname, '..', '..')
  }
  const value = argv[i + 1]
  if (!value) {
    throw new Error('--root needs a path')
  }
  return resolve(value)
}

function toPosix(path) {
  return path.split(sep).join('/')
}

function walk(root, dir, out) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walk(root, full, out)
      }
    } else if (entry.isFile()) {
      out.push(toPosix(relative(root, full)))
    }
  }
}

function isDenied(name) {
  return DENIED_PACKAGES.some((re) => re.test(name))
}

function checkPackageJsons(root, allFiles, failures) {
  const manifests = allFiles.filter(
    (f) =>
      (f === 'package.json' || f.endsWith('/package.json')) &&
      !PACKAGE_JSON_SKIP_ROOTS.some((prefix) => f.startsWith(prefix))
  )
  for (const file of manifests) {
    const json = JSON.parse(readFileSync(join(root, file), 'utf8'))
    for (const field of DEP_FIELDS) {
      for (const name of Object.keys(json[field] ?? {})) {
        if (isDenied(name) && !ALLOWED_PACKAGES.has(name)) {
          failures.push(`${file}: ${field} has denied telemetry SDK "${name}"`)
        }
      }
    }
  }
}

// pnpm lock package keys look like `  name@1.2.3:` or `  '@scope/name@1.2.3':`.
const LOCK_PACKAGE_KEY = /^ {2}'?((?:@[^/@\s']+\/)?[^@\s']+)@\d[^\s']*'?:/
function checkLockfiles(root, failures) {
  for (const file of ['pnpm-lock.yaml', 'mobile/pnpm-lock.yaml']) {
    const path = join(root, file)
    if (!existsSync(path)) {
      continue
    }
    const seen = new Set()
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = LOCK_PACKAGE_KEY.exec(line)
      if (m && isDenied(m[1]) && !ALLOWED_PACKAGES.has(m[1]) && !seen.has(m[1])) {
        seen.add(m[1])
        failures.push(
          `${file}: lock resolves denied telemetry SDK "${m[1]}" (direct or transitive)`
        )
      }
    }
  }
}

const IMPORT_SPECIFIER = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
function packageNameOf(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    return null
  }
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function checkSources(root, allFiles, failures) {
  const sources = allFiles.filter(
    (f) => SCAN_ROOTS.some((r) => f.startsWith(`${r}/`)) && CODE_FILE.test(f) && !TEST_FILE.test(f)
  )
  for (const file of sources) {
    const text = readFileSync(join(root, file), 'utf8')
    const allowedHosts = ALLOWED_HOST_FILES.get(file)?.hosts
    const hostHits = new Set()
    for (const re of DENIED_HOSTS) {
      for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
        if (!allowedHosts?.test(m[0])) {
          hostHits.add(m[0])
        }
      }
    }
    for (const host of [...hostHits].sort()) {
      failures.push(`${file}: references telemetry/vendor-relay host "${host}"`)
    }
    for (const m of text.matchAll(IMPORT_SPECIFIER)) {
      const name = packageNameOf(m[1])
      if (
        name &&
        isDenied(name) &&
        !(ALLOWED_PACKAGES.has(name) && file.startsWith('src/main/telemetry/'))
      ) {
        failures.push(`${file}: imports denied telemetry SDK "${name}"`)
      }
    }
    for (const call of FORBIDDEN_CALLS) {
      if (!call.allowedIn.includes(file) && call.re.test(text)) {
        failures.push(`${file}: starts a vendor channel (${call.re.source})`)
      }
    }
  }
}

function checkKillSwitches(root, failures) {
  for (const sw of KILL_SWITCHES) {
    const path = join(root, sw.file)
    if (!existsSync(path)) {
      failures.push(`${sw.file}: missing; kill switch lost (${sw.what})`)
    } else {
      const text = readFileSync(path, 'utf8')
      if (!sw.mustMatch.test(text) || sw.mustNotMatch?.test(text)) {
        failures.push(`${sw.file}: kill switch reverted (${sw.what})`)
      }
    }
  }
}

function checkAllowListsAreLive(root, failures) {
  for (const file of ALLOWED_HOST_FILES.keys()) {
    if (!existsSync(join(root, file))) {
      failures.push(`${SCRIPT_REL}: stale host allow-list entry ${file}; remove it`)
    }
  }
}

function main() {
  const root = parseRoot(process.argv.slice(2))
  const allFiles = []
  for (const top of readdirSync(root, { withFileTypes: true })) {
    if (top.isFile() && top.name === 'package.json') {
      allFiles.push('package.json')
    }
  }
  for (const dir of ['src', 'mobile', 'native']) {
    if (existsSync(join(root, dir))) {
      walk(root, join(root, dir), allFiles)
    }
  }
  const failures = []
  checkPackageJsons(root, allFiles, failures)
  checkLockfiles(root, failures)
  checkSources(root, allFiles, failures)
  checkKillSwitches(root, failures)
  checkAllowListsAreLive(root, failures)
  if (failures.length > 0) {
    console.error(`fork-check-no-telemetry: ${failures.length} problem(s) in ${root}`)
    for (const f of failures) {
      console.error(`  - ${f}`)
    }
    process.exit(1)
  }
  console.log(`fork-check-no-telemetry: OK (${allFiles.length} files scanned)`)
}

main()
