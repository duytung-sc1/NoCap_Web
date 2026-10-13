const recoveryKey = 'nocap-stale-chunk-recovery-v1'
// The budget follows this deployed bundle, not unrelated successful imports.
const recoveryVersion = import.meta.url

function isChunkLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|loading chunk|chunkloaderror|importing a module script failed/i.test(message)
}

async function resetStaleAppShell(): Promise<void> {
  const appScope = `${window.location.origin}/`
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => [])
    await Promise.all(registrations.filter(registration => registration.scope === appScope)
      .map(registration => registration.unregister().catch(() => false)))
  }
  if ('caches' in globalThis) {
    const names = await caches.keys().catch(() => [])
    await Promise.all(names.filter(name => name.startsWith('workbox-precache-') && name.endsWith(`-${appScope}`))
      .map(name => caches.delete(name).catch(() => false)))
  }
}

/** Load a split bundle and recover once when a service-worker update left stale chunk URLs behind. */
export async function importWithChunkRecovery<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader()
  } catch (error) {
    if (!isChunkLoadFailure(error)) throw error
    // An offline reload cannot repair a missing bundle and would discard the usable shell.
    if (navigator.onLine === false) throw error
    let attempted = false
    try {
      attempted = sessionStorage.getItem(recoveryKey) === recoveryVersion
      if (!attempted) sessionStorage.setItem(recoveryKey, recoveryVersion)
    } catch {
      // Do not risk a reload loop when the browser disables sessionStorage.
      attempted = true
    }
    if (attempted) throw error
    await resetStaleAppShell()
    window.location.reload()
    return new Promise<T>(() => {})
  }
}
