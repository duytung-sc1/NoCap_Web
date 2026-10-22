export const MAX_SPEECH_TEXT = 20000
export type ReaderSpeechText = { text: string; label: string; truncated: boolean }
export type ReaderSpeechSource = (signal: AbortSignal) => Promise<ReaderSpeechText>
export type SpeechStatus = 'idle' | 'speaking' | 'paused' | 'finished' | 'error'
export type SpeechState = { status: SpeechStatus; index: number; total: number; text: string; error?: string }
type SpeechOptions = { voice: SpeechSynthesisVoice; rate: number; pauseMs?: number; allowOnline?: boolean }

export function onlineVoiceProvider(voice: SpeechSynthesisVoice): 'Google' | 'Microsoft' | null {
  if (voice.localService !== false) return null
  if (/^Google\b/i.test(voice.name)) return 'Google'
  if (/^Microsoft\b.*\bOnline\b/i.test(voice.name)) return 'Microsoft'
  return null
}

export function speechVoices(voices: SpeechSynthesisVoice[], allowOnline = false) {
  return Array.from(new Map(voices.filter(voice => voice.localService === true || (allowOnline && onlineVoiceProvider(voice))).map(voice => [voiceKey(voice), voice])).values())
}

export function localSpeechVoices(voices: SpeechSynthesisVoice[]) {
  return speechVoices(voices)
}
export const voiceKey = (voice: SpeechSynthesisVoice) => JSON.stringify([voice.voiceURI, voice.lang, voice.name])
export function speechLanguage(language: string) {
  const base = language.trim().toLowerCase().replace(/_/g, '-').split('-')[0]
  return base === 'vie' || base === 'vietnamese' ? 'vi' : base === 'eng' || base === 'english' ? 'en' : base
}

/** Web Speech has no gender field. Recognize documented voices only; never
 * infer a female voice just from Vietnamese language or an increased pitch.
 * Voice identities: https://github.com/readium/speech/blob/main/json/vi.json */
export function vietnameseVoiceGender(voice: SpeechSynthesisVoice): 'female' | 'male' | null {
  if (speechLanguage(voice.lang) !== 'vi') return null
  const name = `${voice.name} ${voice.voiceURI}`.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  if (/\bhoai\s*my(?:neural)?\b|\blinh\b|\bvi-vn-x-vi[cdf]-(?:local|network)\b|\b(?:google|chrome os) tieng viet [124]\b|\bfemale\b|\bgiong nu\b/.test(name)) return 'female'
  if (/\bnam\s*minh(?:neural)?\b|\bmicrosoft an\b|\bvi-vn-x-(?:vie|gft)-(?:local|network)\b|\b(?:google|chrome os) tieng viet [35]\b|\bmale\b|\bgiong nam\b/.test(name)) return 'male'
  return null
}

function voicePriority(voice: SpeechSynthesisVoice) {
  return onlineVoiceProvider(voice) === 'Microsoft' && /\bNatural\b/i.test(voice.name) ? 2 : onlineVoiceProvider(voice) ? 1 : 0
}

export function vietnameseFemaleVoice(voices: SpeechSynthesisVoice[], allowOnline = false) {
  return speechVoices(voices, allowOnline).filter(voice => vietnameseVoiceGender(voice) === 'female').sort((a, b) => voicePriority(b) - voicePriority(a))[0]
}

export function preferredSpeechVoice(voices: SpeechSynthesisVoice[], language: string, allowOnline = false) {
  const available = speechVoices(voices, allowOnline)
  const target = language.toLowerCase().replace(/_/g, '-')
  const matching = available.filter(voice => speechLanguage(voice.lang) === speechLanguage(target)).sort((a, b) => voicePriority(b) - voicePriority(a))
  return (speechLanguage(target) === 'vi' ? vietnameseFemaleVoice(matching, allowOnline) : undefined)
    ?? matching.find(voice => onlineVoiceProvider(voice))
    ?? matching.find(voice => voice.lang.toLowerCase().replace(/_/g, '-') === target)
    ?? matching[0] ?? available.find(voice => voice.default) ?? available[0]
}

export function speechVoiceSample(language: string) {
  return speechLanguage(language) === 'vi'
    ? 'Chào bạn. Hãy thả lỏng một chút, đọc chậm lại và tận hưởng những trang sách cùng NoCap.'
    : 'Take a quiet moment, slow down, and enjoy your next page with NoCap.'
}

const sentenceEnd = /[.!?。！？…][”"'’)\]]*$/u
const abbreviationEnd = /(?<![\p{L}\p{N}])(?:mr|mrs|ms|dr|prof|sr|jr|vs|etc|ts|ths|pgs|gs|tp|st|e\.g|i\.e|v\.v|v\.d|\p{L})\.$/iu

/** Soft wrapping is not a speech boundary. Keep genuine completed paragraphs,
 * joining incomplete lines emitted as individual blocks by imported documents. */
export function normalizeSpeechText(text: string) {
  const blocks = text.replace(/\r\n?/g, '\n').replace(/\u00ad[ \t]*\n[ \t]*/gu, '').replace(/\u00ad/gu, '')
    .replace(/(\p{L})-[ \t]*\n[ \t]*(?=\p{Ll})/gu, '$1-')
    .split(/\n[ \t]*\n/gu).map(block => block.replace(/\s+/gu, ' ').trim()).filter(Boolean)
  let result = ''
  for (const block of blocks) result += result ? `${sentenceEnd.test(result) && !abbreviationEnd.test(result) ? '\n\n' : ' '}${block}` : block
  return result.slice(0, MAX_SPEECH_TEXT).replace(/[\uD800-\uDBFF]$/u, '')
}

function speechSentences(text: string, language: string) {
  let parts: string[]
  try {
    parts = Array.from(new Intl.Segmenter(speechLanguage(language) || 'vi', { granularity: 'sentence' }).segment(text), item => item.segment)
  } catch {
    const ends = Array.from(text.matchAll(/[.!?。！？]+[”"'’)\]]*(?:\s+|$)/gu), match => match.index! + match[0].length)
    let offset = 0
    parts = [...ends, text.length].map(end => { const part = text.slice(offset, end); offset = end; return part }).filter(Boolean)
  }
  const sentences: string[] = []
  let pending = ''
  for (const part of parts) {
    pending += part
    if (abbreviationEnd.test(pending.trimEnd())) continue
    if (pending.trim()) sentences.push(pending.trim())
    pending = ''
  }
  if (pending.trim()) sentences.push(pending.trim())
  return sentences
}

export type SpeechPassage = { text: string; paragraphEnd: boolean }

/** Prefer complete sentences, with a larger bounded utterance to avoid the
 * voice restarting every few lines. Oversized sentences split at clauses first. */
export function speechPassages(text: string, limit = 900, language = 'vi'): SpeechPassage[] {
  const passages: SpeechPassage[] = []
  const size = Number.isFinite(limit) ? Math.max(40, Math.min(1600, Math.floor(limit))) : 900
  for (const paragraph of normalizeSpeechText(text).split('\n\n').filter(Boolean)) {
    let current = ''
    const flush = () => { if (current) passages.push({ text: current, paragraphEnd: false }); current = '' }
    for (const sentence of speechSentences(paragraph, language)) {
      const points = Array.from(sentence)
      if (current && Array.from(current).length + 1 + points.length > size) flush()
      while (points.length > size) {
        const candidate = points.slice(0, size).join('')
        const clause = Array.from(candidate.matchAll(/[,;:—–][”"'’)\]]*\s/gu)).at(-1)
        const clauseEnd = clause ? Array.from(candidate.slice(0, clause.index! + clause[0].length)).length : 0
        const wordEnd = points.slice(0, size).lastIndexOf(' ')
        const end = clauseEnd >= size / 3 ? clauseEnd : wordEnd >= size / 3 ? wordEnd : size
        passages.push({ text: points.splice(0, end).join('').trim(), paragraphEnd: false })
      }
      const tail = points.join('').trim()
      if (tail) current = current ? `${current} ${tail}` : tail
    }
    flush()
    if (passages.length) passages[passages.length - 1].paragraphEnd = true
  }
  return passages
}

export function splitSpeechText(text: string, limit = 900): string[] {
  return speechPassages(text, limit).map(passage => passage.text)
}

/** One owner, one utterance at a time. Late callbacks cannot restart a cancelled book. */
export function createReaderSpeech(synthesis: SpeechSynthesis, makeUtterance: (text: string) => SpeechSynthesisUtterance, update: (state: SpeechState) => void) {
  let generation = 0, chunks: SpeechPassage[] = [], index = 0
  let status: SpeechStatus = 'idle', options: SpeechOptions | null = null
  let current: SpeechSynthesisUtterance | null = null
  let startTimer: ReturnType<typeof setTimeout> | undefined
  let nextTimer: ReturnType<typeof setTimeout> | undefined
  let started = false, awaitingNext = false
  const emit = (error?: string) => update({ status, index, total: chunks.length, text: chunks[index]?.text || '', ...(error ? { error } : {}) })
  const clearTimer = () => { clearTimeout(startTimer); startTimer = undefined }
  const clearNext = () => { clearTimeout(nextTimer); nextTimer = undefined }
  const cancel = () => { generation++; clearTimer(); clearNext(); current = null; awaitingNext = false; try { synthesis.cancel() } catch { /* A detached browser speech service may already be gone. */ } }
  function fail(code: string) { cancel(); status = 'error'; emit(code) }
  function armTimer(run: number) { clearTimer(); startTimer = setTimeout(() => { if (run === generation && !started && status === 'speaking') fail('not-started') }, 10000) }
  function speakNext(run: number) {
    if (run !== generation || !options) return
    if (index >= chunks.length) { clearTimer(); current = null; status = 'finished'; emit(); return }
    if (!speechVoices([options.voice], options.allowOnline).length) { fail('no-local-voice'); return }
    try {
      const utterance = makeUtterance(chunks[index].text)
      current = utterance; started = false; awaitingNext = false
      utterance.voice = options.voice; utterance.lang = options.voice.lang; utterance.rate = options.rate
      utterance.onstart = () => { if (run === generation && current === utterance) { started = true; clearTimer() } }
      utterance.onend = () => {
        if (run !== generation || current !== utterance) return
        const paragraphEnd = chunks[index].paragraphEnd
        clearTimer(); current = null; index++
        if (status === 'paused') { awaitingNext = true; emit(); return }
        if (index < chunks.length && paragraphEnd && options?.pauseMs) {
          awaitingNext = true
          nextTimer = setTimeout(() => { nextTimer = undefined; if (run === generation && status === 'speaking') speakNext(run) }, options.pauseMs)
          return
        }
        speakNext(run)
      }
      utterance.onerror = event => { if (run === generation && current === utterance) fail(event.error || 'synthesis-failed') }
      status = 'speaking'; emit(); armTimer(run); synthesis.speak(utterance)
    } catch { fail('synthesis-failed') }
  }
  return {
    configure(next: SpeechOptions) { options = { voice: next.voice, rate: Number.isFinite(next.rate) ? Math.max(0.75, Math.min(2, next.rate)) : 1, pauseMs: Number.isFinite(next.pauseMs) ? Math.max(0, Math.min(600, next.pauseMs!)) : 0, allowOnline: next.allowOnline === true } },
    start(text: string) {
      cancel(); chunks = speechPassages(text, 900, options?.voice.lang); index = 0
      if (!options || !speechVoices([options.voice], options.allowOnline).length || !chunks.length) { status = 'error'; emit(!chunks.length ? 'no-text' : 'no-local-voice'); return }
      // cancel() does not consistently clear the browser's paused flag.
      try { synthesis.resume(); speakNext(generation) } catch { fail('synthesis-failed') }
    },
    pause() { if (status !== 'speaking') return; try { synthesis.pause(); clearTimer(); clearNext(); status = 'paused'; emit() } catch { fail('synthesis-failed') } },
    resume() {
      if (status !== 'paused') return
      try { status = 'speaking'; synthesis.resume(); if (awaitingNext) { clearNext(); speakNext(generation) } else { if (!started) armTimer(generation); emit() } } catch { fail('synthesis-failed') }
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
