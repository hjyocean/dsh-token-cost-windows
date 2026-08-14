/**
 * Time-range presets for the summary tab: today, yesterday, last 7/30 days,
 * this month, last month, and a custom window capped at 30 days.
 */

export type TimePreset = 'today' | 'yesterday' | 'd7' | 'd30' | 'month' | 'last-month' | 'custom'

/** Half-open range: from inclusive, to exclusive. */
export interface TimeRange {
  from: number
  to: number
}

import { startOfLocalDay } from './format.ts'

const DAY = 86_400_000

/** Resolve a preset into a half-open range. */
export function presetRange(preset: TimePreset, now = Date.now()): TimeRange {
  const todayStart = startOfLocalDay(now)
  switch (preset) {
    case 'today':
      return { from: todayStart, to: now }
    case 'yesterday':
      return { from: todayStart - DAY, to: todayStart }
    case 'd7':
      return { from: now - 7 * DAY, to: now }
    case 'd30':
      return { from: now - 30 * DAY, to: now }
    case 'month': {
      const from = new Date(todayStart)
      from.setDate(1)
      const to = new Date(from.getTime())
      to.setMonth(to.getMonth() + 1)
      return { from: from.getTime(), to: to.getTime() }
    }
    case 'last-month': {
      const from = new Date(todayStart)
      from.setDate(1)
      from.setMonth(from.getMonth() - 1)
      const to = new Date(from.getTime())
      to.setMonth(to.getMonth() + 1)
      return { from: from.getTime(), to: to.getTime() }
    }
    case 'custom':
      return { from: 0, to: 0 }
  }
}

/** Validate a custom range: end after start, span at most 30 days. */
export function validCustomRange(from: number, to: number): boolean {
  return Number.isFinite(from) && Number.isFinite(to) && to > from && to - from <= 30 * DAY
}