/** Restore delivered React suspense markup as inert data, without running source scripts. */
export function restoreStreamedHtml(document: Document, html: string): number {
  let calls = 0
  let restored = 0
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    for (const call of script[1].matchAll(/\$RC\(\s*"(B:[\da-f]{1,8})"\s*,\s*"(S:[\da-f]{1,8})"\s*\)/gi)) {
      if (++calls > 256) return restored
      const boundary = document.getElementById(call[1])
      const fragment = document.getElementById(call[2])
      if (boundary?.tagName !== 'TEMPLATE' || fragment?.tagName !== 'DIV' || !fragment.hasAttribute('hidden')
        || !document.body.contains(boundary) || !document.body.contains(fragment)
        || boundary.closest('[hidden], [aria-hidden="true"]') || fragment.contains(boundary)
        || fragment.getAttribute('aria-hidden') === 'true') continue
      boundary.replaceWith(...Array.from(fragment.childNodes))
      fragment.remove()
      restored++
    }
  }
  return restored
}

/** Inspect only JSON delivered by Next's stream; expressions and module code are never evaluated. */
export function nextFlightObjects(html: string): Record<string, unknown>[] {
  let flight = ''
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const argument = script[1].match(/^\s*self\.__next_f\.push\(([\s\S]*)\)\s*;?\s*$/)?.[1]
    if (!argument) continue
    try {
      const tuple: unknown = JSON.parse(argument)
      if (Array.isArray(tuple) && tuple[0] === 1 && typeof tuple[1] === 'string') flight += tuple[1]
    } catch { /* Ignore executable or unknown input. */ }
  }
  const objects: Record<string, unknown>[] = []
  let visited = 0
  for (const line of flight.split('\n')) {
    const json = line.match(/^[\da-z]+:([[{].*)$/i)?.[1]
    if (!json) continue
    try {
      const pending: unknown[] = [JSON.parse(json)]
      while (pending.length && ++visited <= 30_000) {
        const value = pending.pop()
        if (!value || typeof value !== 'object') continue
        if (!Array.isArray(value)) objects.push(value as Record<string, unknown>)
        pending.push(...Object.values(value))
      }
      if (visited > 30_000) break
    } catch { /* Partial records cannot supply catalog metadata. */ }
  }
  return objects
}
