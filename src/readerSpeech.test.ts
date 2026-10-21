import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReaderSpeech, localSpeechVoices, MAX_SPEECH_TEXT, preferredSpeechVoice, speechScopeKey, splitSpeechText, type SpeechState } from './readerSpeech'
import { MockSynthesis, MockUtterance, speechVoice } from './readerSpeech.testUtils'

afterEach(() => vi.useRealTimers())
function setup() {
  const synthesis = new MockSynthesis(), states: SpeechState[] = []
  const engine = createReaderSpeech(synthesis.api(), text => new MockUtterance(text) as unknown as SpeechSynthesisUtterance, state => states.push(state))
  engine.configure({ voice: synthesis.voices[0], rate: 1 })
  return { synthesis, engine, states }
}
describe('device speech', () => {
  it('uses only unique local voices and prefers the document language', () => {
    const viVoice = speechVoice(), enVoice = speechVoice('en-US'), cloud = speechVoice('vi-VN', false, 'Cloud')
    expect(localSpeechVoices([cloud, enVoice, viVoice, viVoice])).toEqual([enVoice, viVoice])
    expect(preferredSpeechVoice([enVoice, viVoice], 'vi')).toBe(viVoice)
    expect(preferredSpeechVoice([enVoice], 'vi')).toBe(enVoice)
  })
  it('chunks long Unicode passages without breaking code points, and bounds invalid limits', () => {
    const text = ('Tiếng Việt 😀 rất rõ. Next sentence. ').repeat(1000)
    const chunks = splitSpeechText(text, 80)
    expect(chunks.length).toBeGreaterThan(100)
    expect(chunks.every(chunk => Array.from(chunk).length <= 80)).toBe(true)
    expect(chunks.join(' ').length).toBeLessThanOrEqual(MAX_SPEECH_TEXT + 300)
    expect(chunks.join('').includes('\uFFFD')).toBe(false)
    expect(splitSpeechText('Hello world.', NaN)).toEqual(['Hello world.'])
    expect(splitSpeechText('   ')).toEqual([])
  })
  it('queues one short passage at a time and applies new voice/speed at its next boundary', () => {
    const { synthesis, engine, states } = setup()
    engine.start('A long passage. '.repeat(50))
    expect(synthesis.spoken).toHaveLength(1)
    expect(synthesis.spoken[0].voice?.localService).toBe(true)
    engine.configure({ voice: synthesis.voices[1], rate: 1.5 })
    synthesis.spoken[0].end()
    expect(synthesis.spoken).toHaveLength(2)
    expect(synthesis.spoken[1].voice?.lang).toBe('en-US')
    expect(synthesis.spoken[1].rate).toBe(1.5)
    // Duplicate browser callbacks must not skip the current passage.
    synthesis.spoken[0].end(); synthesis.spoken[0].fail()
    expect(synthesis.spoken).toHaveLength(2)
    while (states.at(-1)!.status === 'speaking') synthesis.spoken.at(-1)!.end()
    expect(states.at(-1)!.status).toBe('finished')
    engine.dispose()
  })
  it('does not advance while paused, even if the browser ends the utterance', () => {
    const { synthesis, engine, states } = setup()
    engine.start('Read this passage. '.repeat(50)); engine.pause()
    synthesis.spoken[0].end()
    expect(synthesis.spoken).toHaveLength(1)
    expect(states.at(-1)!.status).toBe('paused')
    engine.resume()
    expect(synthesis.spoken).toHaveLength(2)
    expect(states.at(-1)!.status).toBe('speaking')
    engine.dispose()
  })
  it('ignores cancelled callbacks after stop, a replacement book or disposal', () => {
    const { synthesis, engine, states } = setup()
    engine.start('Old document. '.repeat(40)); const old = synthesis.spoken[0]
    engine.stop(); old.end(); old.fail()
    expect(states.at(-1)!.status).toBe('idle')
    engine.start('New document.'); old.end()
    expect(synthesis.spoken).toHaveLength(2)
    const count = states.length
    engine.dispose(); synthesis.spoken[1].end()
    expect(states).toHaveLength(count)
  })
  it('rejects remote voices, empty text and browser synthesis failures', () => {
    const { synthesis, engine, states } = setup()
    engine.configure({ voice: speechVoice('vi-VN', false), rate: 1 }); engine.start('Private text')
    expect(synthesis.spoken).toHaveLength(0)
    expect(states.at(-1)!.error).toBe('no-local-voice')
    engine.start(''); expect(states.at(-1)!.error).toBe('no-text')
    engine.configure({ voice: synthesis.voices[0], rate: 1 })
    synthesis.resume.mockImplementationOnce(() => { throw new Error('Service unavailable') })
    engine.start('Text'); expect(states.at(-1)!.error).toBe('synthesis-failed')
    engine.start('Text'); synthesis.spoken.at(-1)!.fail('voice-unavailable')
    expect(states.at(-1)!.error).toBe('voice-unavailable')
    engine.dispose()
  })
  it('times out a voice that never starts, but not a paused or already started voice', () => {
    vi.useFakeTimers()
    const { synthesis, engine, states } = setup()
    synthesis.autoStart = false; engine.start('Text')
    engine.pause(); vi.advanceTimersByTime(15000)
    expect(states.at(-1)!.status).toBe('paused')
    engine.resume(); vi.advanceTimersByTime(10001)
    expect(states.at(-1)!.error).toBe('not-started')
    synthesis.autoStart = true; engine.start('Text'); vi.advanceTimersByTime(60000)
    expect(states.at(-1)!.status).toBe('speaking')
    engine.dispose()
  })
  it('stops on PDF page/EPUB chapter changes without treating scroll offsets as a new chapter', () => {
    expect(speechScopeKey('{"type":"PDF","pageNumber":2}')).toBe('pdf:2')
    expect(speechScopeKey('{"type":"PDF","pageIndex":2}')).toBe('pdf:3')
    expect(speechScopeKey('{"href":"ch1.xhtml","locations":{"cfi":"a"}}')).toBe(speechScopeKey('{"href":"ch1.xhtml","locations":{"cfi":"b"}}'))
    expect(speechScopeKey('{"href":"ch2.xhtml"}')).not.toBe('section:ch1.xhtml')
    expect(speechScopeKey('malformed')).toBe('document')
  })
})
