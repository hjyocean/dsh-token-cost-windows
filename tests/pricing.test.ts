/**
 * Price engine tests: scheme resolution by record time (the price-increase
 * auto-switch), peak/off-peak billing, custom price overrides and totals.
 */

import { describe, expect, it } from 'vitest'
import {
  PRICE_SCHEMES,
  SCHEME_B_EFFECTIVE_FROM,
  isPeakHour,
  normalizeModel,
  parseCustomPrices,
  priceRecord,
  resolveScheme,
  totalsFor,
  withCustomPrices,
} from '../src/pricing.ts'
import type { UsageRecord } from '../src/protocol.ts'

function record(partial: Partial<UsageRecord>): UsageRecord {
  return {
    time: 1_700_000_000_000,
    turn: 1,
    step: 1,
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    inputTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    sessionId: 's1',
    sessionLabel: 'S1',
    ...partial,
  }
}

describe('resolveScheme', () => {
  it('uses scheme-a before the switch instant and scheme-b after', () => {
    expect(resolveScheme(PRICE_SCHEMES, SCHEME_B_EFFECTIVE_FROM - 1).id).toBe('scheme-a')
    expect(resolveScheme(PRICE_SCHEMES, SCHEME_B_EFFECTIVE_FROM).id).toBe('scheme-b')
    expect(resolveScheme(PRICE_SCHEMES, SCHEME_B_EFFECTIVE_FROM + 86_400_000).id).toBe('scheme-b')
  })

  it('honours a forced scheme id', () => {
    expect(resolveScheme(PRICE_SCHEMES, SCHEME_B_EFFECTIVE_FROM + 1, 'scheme-a').id).toBe('scheme-a')
    expect(resolveScheme(PRICE_SCHEMES, 0, 'scheme-b').id).toBe('scheme-b')
  })
})

describe('isPeakHour', () => {
  const schemeB = PRICE_SCHEMES[1]!
  // 2026-08-17 10:00 UTC is inside the 06-10 window (end exclusive).
  it('window boundaries are start-inclusive, end-exclusive', () => {
    const hour = (h: number): number => Date.UTC(2026, 7, 17, h, 0, 0)
    expect(isPeakHour(schemeB, hour(0))).toBe(false)
    expect(isPeakHour(schemeB, hour(1))).toBe(true)
    expect(isPeakHour(schemeB, hour(3))).toBe(true)
    expect(isPeakHour(schemeB, hour(4))).toBe(false)
    expect(isPeakHour(schemeB, hour(6))).toBe(true)
    expect(isPeakHour(schemeB, hour(9))).toBe(true)
    expect(isPeakHour(schemeB, hour(10))).toBe(false)
  })
})

describe('priceRecord', () => {
  it('bills 1M miss tokens at the scheme-a flash rate (CNY 1)', () => {
    const cost = priceRecord(record({ inputTokens: 1_000_000 }), PRICE_SCHEMES, 'scheme-a')
    expect(cost).not.toBeNull()
    expect(cost!.costCny).toBeCloseTo(1, 6)
    expect(cost!.costUsd).toBeCloseTo(0.14, 6)
    expect(cost!.peak).toBeNull()
  })

  it('bills cache hits at the hit rate', () => {
    const cost = priceRecord(record({ inputTokens: 0, cacheReadTokens: 1_000_000 }), PRICE_SCHEMES, 'scheme-a')
    expect(cost!.costCny).toBeCloseTo(0.02, 6)
  })

  it('scheme-b charges half off-peak and full at peak for v4-flash', () => {
    const offpeak = record({ inputTokens: 0, time: Date.UTC(2026, 7, 17, 0, 0, 0), outputTokens: 1_000_000 })
    const peak = record({ inputTokens: 0, time: Date.UTC(2026, 7, 17, 2, 0, 0), outputTokens: 1_000_000 })
    expect(priceRecord(offpeak, PRICE_SCHEMES)!.costCny).toBeCloseTo(4.5, 6)
    expect(priceRecord(peak, PRICE_SCHEMES)!.costCny).toBeCloseTo(9, 6)
    expect(priceRecord(peak, PRICE_SCHEMES)!.peak).toBe(true)
    expect(priceRecord(offpeak, PRICE_SCHEMES)!.peak).toBe(false)
  })

  it('keeps legacy models flat inside scheme-b', () => {
    const chat = record({ model: 'deepseek-chat', inputTokens: 1_000_000, time: Date.UTC(2026, 7, 17, 2, 0, 0) })
    const cost = priceRecord(chat, PRICE_SCHEMES)!
    expect(cost.costCny).toBeCloseTo(2, 6)
    expect(cost.peak).toBeNull()
  })

  it('returns null for unknown models', () => {
    expect(priceRecord(record({ model: 'gpt-4o' }), PRICE_SCHEMES)).toBeNull()
  })
})

describe('totalsFor', () => {
  it('sums tokens and cost across mixed schemes', () => {
    const records = [
      record({ inputTokens: 1_000_000, time: SCHEME_B_EFFECTIVE_FROM - 1 }),
      record({ inputTokens: 1_000_000, outputTokens: 500_000, time: Date.UTC(2026, 7, 17, 0, 0, 0) }),
    ]
    const { totals, priced } = totalsFor(records, PRICE_SCHEMES)
    expect(totals.inputTokens).toBe(2_000_000)
    expect(totals.outputTokens).toBe(500_000)
    expect(totals.records).toBe(2)
    expect(priced).toBe(2)
    // 1 CNY (scheme-a miss) + 1.5 CNY (off-peak miss) + 4.5 * 0.5 (off-peak output)
    expect(totals.costCny).toBeCloseTo(1 + 1.5 + 2.25, 6)
  })

  it('computes cache hit rate over billed input', () => {
    const { totals } = totalsFor([
      record({ inputTokens: 300, cacheReadTokens: 700 }),
    ], PRICE_SCHEMES)
    expect(totals.cacheHitRate).toBeCloseTo(0.7, 6)
  })
})

describe('custom prices', () => {
  it('parses and overrides a model price', () => {
    const custom = parseCustomPrices('{"my-model":{"cny":{"miss":9,"hit":1,"output":18},"usd":{"miss":1.2,"hit":0.1,"output":2.4}}}')
    const schemes = withCustomPrices(PRICE_SCHEMES, custom)
    const cost = priceRecord(record({ model: 'MY-MODEL', inputTokens: 1_000_000 }), schemes, 'scheme-a')
    expect(cost!.costCny).toBeCloseTo(9, 6)
  })

  it('rejects malformed input', () => {
    expect(() => parseCustomPrices('[]')).toThrow()
    expect(() => parseCustomPrices('{"x":{"cny":{"miss":-1}} }')).toThrow()
    expect(() => parseCustomPrices('not json')).toThrow()
  })
})

describe('normalizeModel', () => {
  it('lowercases and trims', () => {
    expect(normalizeModel(' DeepSeek-V4-Flash ')).toBe('deepseek-v4-flash')
  })
})