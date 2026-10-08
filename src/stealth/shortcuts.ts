export type StealthShortcut =
  | { type: 'panic' | 'close' | 'home' | 'help' | 'dismiss-help' | 'fullscreen' | 'exit-fullscreen' | 'clear-search' | 'auto-scroll' | 'consume' }
  | { type: 'mode'; mode: 'excel' | 'vscode' | 'doc' }
  | { type: 'move' | 'font-size' | 'scroll-speed' | 'opacity'; delta: number }

interface KeyInput {
  key: string
  code?: string
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  repeat?: boolean
  editing?: boolean
  helpOpen?: boolean
  panic?: boolean
  fullscreen?: boolean
}

/** Keeps editing and browser shortcuts separate from reading navigation. */
export function stealthShortcut(input: KeyInput): StealthShortcut | null {
  if (input.ctrlKey || input.metaKey || input.shiftKey) return null
  const key = input.key.toLowerCase()
  const once = (action: StealthShortcut): StealthShortcut => input.repeat ? { type: 'consume' } : action

  // These remain available while a search field or the settings dialog is focused.
  if ((!input.altKey && key === 'f12') || (input.altKey && key === 'p')) return once({ type: 'panic' })
  if (!input.altKey && key === 'f2') return once({ type: 'close' })
  if ((!input.altKey && key === 'f10') || (input.altKey && key === 'f')) return once({ type: 'fullscreen' })
  if (!input.altKey && key === 'f1') return once({ type: 'help' })

  if (!input.altKey && key === 'escape') {
    if (input.fullscreen) return once({ type: 'exit-fullscreen' })
    if (input.helpOpen) return once({ type: 'dismiss-help' })
    if (input.editing) return once({ type: 'clear-search' })
    if (input.panic) return once({ type: 'panic' })
    return once({ type: 'home' })
  }
  if (input.editing || input.helpOpen) return null

  if (input.altKey) {
    const digit = input.code?.match(/^Digit([123])$/)?.[1] || key
    if (digit === '1') return once({ type: 'mode', mode: 'excel' })
    if (digit === '2') return once({ type: 'mode', mode: 'vscode' })
    if (digit === '3') return once({ type: 'mode', mode: 'doc' })
    if (key === 'a') return once({ type: 'auto-scroll' })
    if (key === 'arrowup') return { type: 'font-size', delta: 1 }
    if (key === 'arrowdown') return { type: 'font-size', delta: -1 }
    if (key === 'arrowleft') return { type: 'scroll-speed', delta: -1 }
    if (key === 'arrowright') return { type: 'scroll-speed', delta: 1 }
    if (key === '[') return { type: 'opacity', delta: -0.05 }
    if (key === ']') return { type: 'opacity', delta: 0.05 }
    return null
  }
  if (input.panic) return null
  if (key === 'arrowdown' || key === ' ' || key === 'j') return { type: 'move', delta: 1 }
  if (key === 'arrowup' || key === 'k') return { type: 'move', delta: -1 }
  if (key === 'pagedown') return { type: 'move', delta: 15 }
  if (key === 'pageup') return { type: 'move', delta: -15 }
  return null
}
