import { useState } from 'react'
import type { MobilePairingConnectionMode } from '../../../../shared/mobile-pairing-connection-mode'

/** Resolve persisted mode and sign-in consistently across MobilePage and MobilePane. */
export function useMobilePairingConnectionMode(): [
  MobilePairingConnectionMode,
  React.Dispatch<React.SetStateAction<MobilePairingConnectionMode>>
] {
  // fork:local-only — Relay is never offered; phones pair over LAN only.
  return useState<MobilePairingConnectionMode>('local-only')
}
