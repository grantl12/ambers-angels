/**
 * Module-level singleton that carries a "pan to here" target from a
 * notification tap (handled in App.tsx) to MapScreen (consumed on focus).
 * Using a module variable avoids prop-drilling or a context provider.
 */
export type AlertTarget = {
  lat: number
  lng: number
  label: string
}

let _pending: AlertTarget | null = null

export function setPendingAlertTarget(t: AlertTarget | null): void {
  _pending = t
}

/** Returns and clears the pending target so it only fires once. */
export function consumePendingAlertTarget(): AlertTarget | null {
  const t = _pending
  _pending = null
  return t
}
