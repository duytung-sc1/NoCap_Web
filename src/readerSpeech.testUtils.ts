import { vi } from 'vitest'

export function speechVoice(lang = 'vi-VN', localService = true, name = lang): SpeechSynthesisVoice {
  return { lang, name, voiceURI: name, localService, default: false }
}
export class MockUtterance {
  text: string
  voice: SpeechSynthesisVoice | null = null
  lang = ''
  rate = 1
  pitch = 1
  onstart: SpeechSynthesisUtterance['onstart'] = null
  onend: SpeechSynthesisUtterance['onend'] = null
  onerror: SpeechSynthesisUtterance['onerror'] = null
  constructor(text: string) { this.text = text }
  begin() { this.onstart?.call(this as unknown as SpeechSynthesisUtterance, {} as SpeechSynthesisEvent) }
  end() { this.onend?.call(this as unknown as SpeechSynthesisUtterance, {} as SpeechSynthesisEvent) }
  fail(error = 'synthesis-failed') { this.onerror?.call(this as unknown as SpeechSynthesisUtterance, { error } as SpeechSynthesisErrorEvent) }
}
export class MockSynthesis extends EventTarget {
  voices: SpeechSynthesisVoice[] = [speechVoice(), speechVoice('en-US')]
  spoken: MockUtterance[] = []
  autoStart = true
  getVoices = () => this.voices
  cancel = vi.fn()
  pause = vi.fn()
  resume = vi.fn()
  speak = vi.fn((utterance: SpeechSynthesisUtterance) => {
    const value = utterance as unknown as MockUtterance
    this.spoken.push(value)
    if (this.autoStart) value.begin()
  })
  api() { return this as unknown as SpeechSynthesis }
}
