/**
 * Day bucketing tests: the summary's byDay groups follow the requesting
 * client's timezone offset, so a conversation crossing midnight (or a viewer
 * switching timezone) splits on the viewer's days, not UTC.
 */

import { describe, expect, it } from 'vitest'
import { dayLabelForTime } from '../src/routes.ts'

/** Beijing 2026-08-14 00:30 local = 2026-08-13 16:30 UTC. */
const BEIJING_MIDNIGHT_PLUS_30 = Date.UTC(2026, 7, 13, 16, 30, 0)

describe('dayLabelForTime', () => {
  it('groups by the client offset, not UTC', () => {
    expect(dayLabelForTime(BEIJING_MIDNIGHT_PLUS_30, 480)).toBe('2026-08-14')
    expect(dayLabelForTime(BEIJING_MIDNIGHT_PLUS_30, 0)).toBe('2026-08-13')
  })

  it('keeps afternoon records on the same day in both systems', () => {
    const afternoon = Date.UTC(2026, 7, 14, 6, 0, 0) // Beijing 14:00 = UTC 06:00
    expect(dayLabelForTime(afternoon, 480)).toBe('2026-08-14')
    expect(dayLabelForTime(afternoon, 0)).toBe('2026-08-14')
  })

  it('handles negative offsets (west of UTC)', () => {
    // New York 2026-08-14 00:30 local = UTC 04:30 same day (EDT -4)
    const ny = Date.UTC(2026, 7, 14, 4, 30, 0)
    expect(dayLabelForTime(ny, -240)).toBe('2026-08-14')
  })
})
