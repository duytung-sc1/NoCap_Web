import { describe, expect, it } from 'vitest'
import { readingActivity } from './readingStats'

const noon = (day: number) => new Date(2026, 9, day, 12).getTime()
describe('reading days in the reader’s local calendar', () => {
  it('counts duplicate sessions once and separates total activity from a streak', () => {
    expect(readingActivity([noon(1), noon(5), noon(7), noon(7), noon(8)], new Date(noon(8)))).toEqual({ activeDays: 4, streak: 2 })
  })
  it('keeps yesterday’s streak until the next day ends', () => {
    expect(readingActivity([noon(5), noon(6), noon(7)], new Date(noon(8))).streak).toBe(3)
  })
  it('does not call an old run a current streak', () => {
    expect(readingActivity([noon(5), noon(6)], new Date(noon(8)))).toEqual({ activeDays: 2, streak: 0 })
  })
  it('uses calendar days rather than UTC date strings or session counts', () => {
    const midnight = new Date(2026, 9, 8, 0, 1)
    expect(readingActivity([new Date(2026, 9, 7, 23, 59).getTime(), midnight.getTime()], midnight).streak).toBe(2)
  })
  it('ignores invalid and future sessions', () => {
    expect(readingActivity([NaN, Infinity, 0, noon(9)], new Date(noon(8)))).toEqual({ activeDays: 0, streak: 0 })
  })
})
