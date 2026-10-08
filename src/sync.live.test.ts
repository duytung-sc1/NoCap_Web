import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectLiveSync } from './sync'
import type { Session } from './types'

class TestSocket {
  static OPEN = 1
  static instances: TestSocket[] = []
  url: string
  readyState = 1
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(url: string) { this.url = url; TestSocket.instances.push(this) }
  send(text: string) { this.sent.push(text) }
  close() { this.readyState = 3 }
}
const session: Session = { token: 'a'.repeat(64), expiresAt: Date.now()/1000 + 10000, user: { id: 'live-test', email: 'live@example.test', emailVerified: true } }

beforeEach(() => { vi.useFakeTimers(); TestSocket.instances = []; vi.stubGlobal('WebSocket', TestSocket) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('live synchronization lifecycle', () => {
  it('opens distinct connections for tabs on one device and keeps identity through reconnect', async () => {
    const stopA = connectLiveSync(session, '11111111-1111-4111-8111-111111111111', () => {})
    const stopB = connectLiveSync(session, '11111111-1111-4111-8111-111111111111', () => {})
    try {
      const [a,b] = TestSocket.instances
      const first = new URL(a.url), second = new URL(b.url)
      expect(first.searchParams.get('device')).toBe(second.searchParams.get('device'))
      expect(first.searchParams.get('connection')).not.toBe(second.searchParams.get('connection'))
      a.onclose?.({ code: 1006, reason: '' })
      await vi.advanceTimersByTimeAsync(2000)
      expect(new URL(TestSocket.instances[2].url).searchParams.get('connection')).toBe(first.searchParams.get('connection'))
    } finally { stopA(); stopB() }
  })
  it('catches up on ready, sends heartbeat and cancels timers on cleanup', async () => {
    const notified = vi.fn()
    const stop = connectLiveSync(session, crypto.randomUUID(), notified)
    const socket = TestSocket.instances[0]
    socket.onopen?.()
    socket.onmessage?.({ data: JSON.stringify({ type: 'ready' }) })
    expect(notified).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(25000)
    expect(socket.sent).toEqual(['ping'])
    stop()
    await vi.advanceTimersByTimeAsync(60000)
    expect(socket.sent).toEqual(['ping'])
    expect(TestSocket.instances).toHaveLength(1)
  })
  it('does not reconnect revoked sessions or connections replaced by the server', async () => {
    const stop = connectLiveSync(session, crypto.randomUUID(), () => {})
    TestSocket.instances[0].onclose?.({ code: 1008, reason: 'Session expired' })
    await vi.advanceTimersByTimeAsync(60000)
    expect(TestSocket.instances).toHaveLength(1)
    stop()
    const stopReplaced = connectLiveSync(session, crypto.randomUUID(), () => {})
    TestSocket.instances[1].onclose?.({ code: 1000, reason: 'Replaced by a newer connection' })
    await vi.advanceTimersByTimeAsync(60000)
    expect(TestSocket.instances).toHaveLength(2)
    stopReplaced()
  })
})
