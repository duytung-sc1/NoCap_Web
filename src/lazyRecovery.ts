const recoveryKey = 'nocap-stale-chunk-recovery-v1'

function isChunkLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|loading chunk|chunkloaderror|importing a module script failed/i.test(message)
}

async function resetStaleAppShell(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => [])
    await Promise.all(registrations.map(registration => registration.unregister().catch(() => false)))
  }
  if ('caches' in globalThis) {
    const names = await caches.keys().catch(() => [])
    await Promise.all(names.map(name => caches.delete(name).catch(() => false)))
  }
}

/** Load a split bundle and recover once when a service-worker update left stale chunk URLs behind. */
export async function importWithChunkRecovery<T>(loader: () => Promise<T>): Promise<T> {
  try {
    const module = await loader()
    try { sessionStorage.removeItem(recoveryKey) } catch { /* storage may be disabled */ }
    return module
  } catch (error) {
    if (!isChunkLoadFailure(error)) throw error
    let attempted = false
    try {
      attempted = sessionStorage.getItem(recoveryKey) === '1'
      if (!attempted) sessionStorage.setItem(recoveryKey, '1')
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
