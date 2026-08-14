/** Number and token formatters for the token-cost surfaces. */

/** Adaptive money formatting: enough digits that small bills stay readable. */
export function formatMoney(value: number, currency: 'cny' | 'usd'): string {
  const prefix = currency === 'cny' ? '¥' : '$'
  if (value >= 100) return `${prefix}${value.toFixed(0)}`
  if (value >= 1) return `${prefix}${value.toFixed(2)}`
  if (value >= 0.0001) return `${prefix}${value.toFixed(4)}`
  return `${prefix}${value.toFixed(6)}`
}

/** Compact token count: 517 / 12.3K / 1.2M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Integer percent, 0-100. */
export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

/** Short wall-clock for a record row (locale-aware). */
export function formatClock(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Short date for daily rows. */
export function formatDay(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local-midnight instant of a date. */
export function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}
