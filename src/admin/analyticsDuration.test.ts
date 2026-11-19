import { describe, expect, it } from 'vitest'
import { analyticsDuration } from './analyticsDuration'

describe('analytics duration precision', () => {
  it.each([
    [0, '0 giây', '0 sec'],
    [499, '0 giây', '0 sec'],
    [500, '1 giây', '1 sec'],
    [59_499, '59 giây', '59 sec'],
    [59_500, '1 phút', '1 min'],
    [60_506.54, '1 phút 1 giây', '1 min 1 sec'],
    [3_599_499, '59 phút 59 giây', '59 min 59 sec'],
    [3_599_500, '1 giờ', '1 hr'],
    [3_600_500, '1 giờ 1 giây', '1 hr 1 sec'],
    [7_805_344, '2 giờ 10 phút 5 giây', '2 hr 10 min 5 sec'],
    [86_400_000, '24 giờ', '24 hr'],
  ])('formats %d ms without discarding seconds or producing 60-second components', (value, vi, en) => {
    expect(analyticsDuration(value, 'vi')).toBe(vi)
    expect(analyticsDuration(value, 'en')).toBe(en)
  })

  it.each([-1, -60_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('safely renders invalid or negative duration %s as zero', value => {
    expect(analyticsDuration(value, 'vi')).toBe('0 giây')
    expect(analyticsDuration(value, 'en')).toBe('0 sec')
  })
})
