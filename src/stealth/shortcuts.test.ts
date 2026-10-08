import { describe, expect, it } from 'vitest'
import { stealthShortcut } from './shortcuts'

describe('stealth keyboard controls', () => {
  it('keeps emergency and exit controls available while editing or in settings', () => {
    expect(stealthShortcut({ key: 'P', altKey: true, editing: true })).toEqual({ type: 'panic' })
    expect(stealthShortcut({ key: 'F12', helpOpen: true })).toEqual({ type: 'panic' })
    expect(stealthShortcut({ key: 'F2', editing: true })).toEqual({ type: 'close' })
    expect(stealthShortcut({ key: 'F10', helpOpen: true })).toEqual({ type: 'fullscreen' })
  })

  it('consumes held toggle keys without toggling repeatedly', () => {
    for (const key of ['F1', 'F2', 'F10', 'F12', 'Escape']) {
      expect(stealthShortcut({ key, repeat: true })).toEqual({ type: 'consume' })
    }
    expect(stealthShortcut({ key: 'ArrowDown', repeat: true })).toEqual({ type: 'move', delta: 1 })
  })

  it('does not navigate or change appearance while editing fields or settings', () => {
    for (const key of ['ArrowDown', 'PageDown', ' ', 'j', 'k']) {
      expect(stealthShortcut({ key, editing: true })).toBeNull()
      expect(stealthShortcut({ key, helpOpen: true })).toBeNull()
    }
    expect(stealthShortcut({ key: 'ArrowUp', altKey: true, editing: true })).toBeNull()
  })

  it('reserves Escape for fullscreen, settings, editing, panic, then home', () => {
    expect(stealthShortcut({ key: 'Escape', fullscreen: true, helpOpen: true, panic: true })).toEqual({ type: 'exit-fullscreen' })
    expect(stealthShortcut({ key: 'Escape', helpOpen: true, panic: true })).toEqual({ type: 'dismiss-help' })
    expect(stealthShortcut({ key: 'Escape', editing: true })).toEqual({ type: 'clear-search' })
    expect(stealthShortcut({ key: 'Escape', panic: true })).toEqual({ type: 'panic' })
    expect(stealthShortcut({ key: 'Escape' })).toEqual({ type: 'home' })
  })

  it('leaves browser, text selection and modified function keys alone', () => {
    expect(stealthShortcut({ key: 'ArrowDown', shiftKey: true })).toBeNull()
    expect(stealthShortcut({ key: 'j', ctrlKey: true })).toBeNull()
    expect(stealthShortcut({ key: 'F12', ctrlKey: true, shiftKey: true })).toBeNull()
    expect(stealthShortcut({ key: 'p', altKey: true, ctrlKey: true })).toBeNull()
    expect(stealthShortcut({ key: 'F11' })).toBeNull()
  })

  it('changes disguises and settings without treating Alt arrows as row navigation', () => {
    expect(stealthShortcut({ key: '2', altKey: true })).toEqual({ type: 'mode', mode: 'vscode' })
    expect(stealthShortcut({ key: 'é', code: 'Digit2', altKey: true })).toEqual({ type: 'mode', mode: 'vscode' })
    expect(stealthShortcut({ key: '1', altKey: true })).toEqual({ type: 'mode', mode: 'excel' })
    expect(stealthShortcut({ key: '3', altKey: true })).toEqual({ type: 'mode', mode: 'doc' })
    expect(stealthShortcut({ key: 'a', altKey: true })).toEqual({ type: 'auto-scroll' })
    expect(stealthShortcut({ key: 'ArrowUp', altKey: true })).toEqual({ type: 'font-size', delta: 1 })
    expect(stealthShortcut({ key: 'ArrowLeft', altKey: true })).toEqual({ type: 'scroll-speed', delta: -1 })
    expect(stealthShortcut({ key: '[', altKey: true })).toEqual({ type: 'opacity', delta: -0.05 })
  })

  it('does not change the reading position during the emergency screen', () => {
    expect(stealthShortcut({ key: 'ArrowDown', panic: true })).toBeNull()
    expect(stealthShortcut({ key: 'PageDown', panic: true })).toBeNull()
    expect(stealthShortcut({ key: 'F12', panic: true })).toEqual({ type: 'panic' })
  })
})
