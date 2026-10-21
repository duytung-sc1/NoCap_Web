export const MAX_SPEECH_TEXT = 20000
export type ReaderSpeechText = { text: string; label: string; truncated: boolean }
export type ReaderSpeechSource = (signal: AbortSignal) => Promise<ReaderSpeechText>
export type SpeechStatus = 'idle' | 'speaking' | 'paused' | 'finished' | 'error'
export type SpeechState = { status: SpeechStatus; index: number; total: number; text: string; error?: string }
type SpeechOptions = { voice: SpeechSynthesisVoice; rate: number }

export function localSpeechVoices(voices: SpeechSynthesisVoice[]) {
  return Array.from(new Map(voices.filter(voice => voice.localService === true).map(voice => [voiceKey(voice), voice])).values())
}
export const voiceKey = (voice: SpeechSynthesisVoice) => JSON.stringify([voice.voiceURI, voice.lang, voice.name])
export function preferredSpeechVoice(voices: SpeechSynthesisVoice[], language: string) {
  const target = language.toLowerCase().replace(/_/g, '-')
  return voices.find(voice => voice.lang.toLowerCase().replace(/_/g, '-') === target)
    ?? voices.find(voice => voice.lang.toLowerCase().split('-')[0] === target.split('-')[0])
    ?? voices.find(voice => voice.default) ?? voices[0]
}

/** Bound utterances so long chapters do not become a single fragile speech job. */
export function splitSpeechText(text: string, limit = 240): string[] {
  const bounded = text.replace(/\s+/gu, ' ').trim().slice(0, MAX_SPEECH_TEXT).replace(/[\uD800-\uDBFF]$/u, '')
  const input = Array.from(bounded)
  const chunks: string[] = []
  const size = Number.isFinite(limit) ? Math.max(40, Math.min(500, Math.floor(limit))) : 240
  while (input.length) {
    let end = Math.min(size, input.length)
    if (end < input.length) {
      const candidate = input.slice(0, end).join('')
      const sentence = Array.from(candidate.matchAll(/[.!?。！？][”"')\]]?\s/gu)).at(-1)
      const boundary = sentence ? Array.from(candidate.slice(0, sentence.index! + sentence[0].length)).length : input.slice(0, end).lastIndexOf(' ')
      if (boundary > size / 3) end = boundary
    }
    const chunk = input.splice(0, end).join('').trim()
    if (chunk) chunks.push(chunk)
  }
  return chunks
}

/** One owner, one utterance at a time. Late callbacks cannot restart a cancelled book. */
export function createReaderSpeech(synthesis: SpeechSynthesis, makeUtterance: (text: string) => SpeechSynthesisUtterance, update: (state: SpeechState) => void) {
  let generation = 0, chunks: string[] = [], index = 0
  let status: SpeechStatus = 'idle', options: SpeechOptions | null = null
  let current: SpeechSynthesisUtterance | null = null
  let startTimer: ReturnType<typeof setTimeout> | undefined
  let started = false, awaitingNext = false
  const emit = (error?: string) => update({ status, index, total: chunks.length, text: chunks[index] || '', ...(error ? { error } : {}) })
  const clearTimer = () => { clearTimeout(startTimer); startTimer = undefined }
  const cancel = () => { generation++; clearTimer(); current = null; awaitingNext = false; try { synthesis.cancel() } catch { /* A detached browser speech service may already be gone. */ } }
  function fail(code: string) { cancel(); status = 'error'; emit(code) }
  function armTimer(run: number) { clearTimer(); startTimer = setTimeout(() => { if (run === generation && !started && status === 'speaking') fail('not-started') }, 10000) }
  function speakNext(run: number) {
    if (run !== generation || !options) return
    if (index >= chunks.length) { clearTimer(); current = null; status = 'finished'; emit(); return }
    try {
      const utterance = makeUtterance(chunks[index])
      current = utterance; started = false; awaitingNext = false
      utterance.voice = options.voice; utterance.lang = options.voice.lang; utterance.rate = options.rate
      utterance.onstart = () => { if (run === generation && current === utterance) { started = true; clearTimer() } }
      utterance.onend = () => {
        if (run !== generation || current !== utterance) return
        clearTimer(); current = null; index++
        if (status === 'paused') { awaitingNext = true; emit(); return }
        speakNext(run)
      }
      utterance.onerror = event => { if (run === generation && current === utterance) fail(event.error || 'synthesis-failed') }
      status = 'speaking'; emit(); armTimer(run); synthesis.speak(utterance)
    } catch { fail('synthesis-failed') }
  }
  return {
    configure(next: SpeechOptions) { options = { voice: next.voice, rate: Number.isFinite(next.rate) ? Math.max(0.75, Math.min(2, next.rate)) : 1 } },
    start(text: string) {
      cancel(); chunks = splitSpeechText(text); index = 0
      if (!options || options.voice.localService !== true || !chunks.length) { status = 'error'; emit(!chunks.length ? 'no-text' : 'no-local-voice'); return }
      // cancel() does not consistently clear the browser's paused flag.
      try { synthesis.resume(); speakNext(generation) } catch { fail('synthesis-failed') }
    },
    pause() { if (status !== 'speaking') return; try { synthesis.pause(); clearTimer(); status = 'paused'; emit() } catch { fail('synthesis-failed') } },
    resume() {
      if (status !== 'paused') return
      try { status = 'speaking'; synthesis.resume(); if (awaitingNext) speakNext(generation); else { if (!started) armTimer(generation); emit() } } catch { fail('synthesis-failed') }
    },
    stop() { cancel(); chunks = []; index = 0; status = 'idle'; emit() },
    dispose() { cancel(); chunks = []; options = null },
  }
}

export function speechScopeKey(locator?: string | null) {
  try {
    const value = JSON.parse(locator || '{}') as { type?: string; href?: string; pageNumber?: number; pageIndex?: number }
    if (value.type === 'PDF') return `pdf:${value.pageNumber ?? (value.pageIndex ?? 0) + 1}`
    return value.href ? `section:${value.href}` : 'document'
  } catch { return 'document' }
}
