/**
 * Price engine for dsh-token-cost: the built-in DeepSeek official price
 * catalog as an ordered list of pricing schemes, each with an effective-from
 * instant. Billing picks, per record, the newest scheme whose effectiveFrom
 * is not after the record's time — so when DeepSeek changes prices again,
 * shipping one more scheme entry is the whole adaptation, no code changes.
 *
 * Catalog source: https://api-docs.deepseek.com/quick_start/pricing
 * (fetched 2026-08-14; the CNY table and the USD table agree).
 *
 * Scheme A (flat, until 2026-08-16T16:00Z):
 *   deepseek-v4-flash  cny miss 1 / hit 0.02 / out 2     usd 0.14 / 0.0028 / 0.28
 *   deepseek-v4-pro    cny miss 3 / hit 0.025 / out 6     usd 0.435 / 0.003625 / 0.87
 *   deepseek-chat      cny miss 2 / hit 0.5 / out 8       usd 0.27 / 0.07 / 1.10   (legacy flat)
 *   deepseek-reasoner  cny miss 4 / hit 1 / out 16        usd 0.55 / 0.14 / 2.19   (legacy flat)
 *
 * Scheme B (peak/off-peak, from 2026-08-16T16:00Z = 2026-08-17 00:00 Beijing):
 *   peak hours UTC 01-04 and 06-10 (Beijing 9-12, 14-18); off-peak bills half.
 *   deepseek-v4-flash  peak cny miss 3 / hit 0.10 / out 9     usd 0.44 / 0.014 / 1.32
 *   deepseek-v4-pro    peak cny miss 9 / hit 0.30 / out 27    usd 1.32 / 0.044 / 3.96
 *   legacy models keep their flat prices (not covered by the announcement).
 *
 * Prices are per 1M tokens; cost = tokens / 1e6 * price.
 */

import type { ModelPrice, PriceScheme, UsageRecord } from './protocol.ts'

/** UTC instant the peak/off-peak scheme starts billing. */
export const SCHEME_B_EFFECTIVE_FROM = Date.UTC(2026, 7, 16, 16, 0, 0)

/** Normalize a model id for catalog lookup (case-insensitive, trimmed). */
export function normalizeModel(model: string): string {
  return model.trim().toLowerCase()
}

/** The built-in catalog: newest last. */
export const PRICE_SCHEMES: PriceScheme[] = [
  {
    id: 'scheme-a',
    label: 'flat-2026-08',
    effectiveFrom: 0,
    models: {
      'deepseek-v4-flash': {
        cny: { miss: 1, hit: 0.02, output: 2 },
        usd: { miss: 0.14, hit: 0.0028, output: 0.28 },
      },
      'deepseek-v4-pro': {
        cny: { miss: 3, hit: 0.025, output: 6 },
        usd: { miss: 0.435, hit: 0.003625, output: 0.87 },
      },
      'deepseek-chat': {
        cny: { miss: 2, hit: 0.5, output: 8 },
        usd: { miss: 0.27, hit: 0.07, output: 1.1 },
        flat: true,
      },
      'deepseek-reasoner': {
        cny: { miss: 4, hit: 1, output: 16 },
        usd: { miss: 0.55, hit: 0.14, output: 2.19 },
        flat: true,
      },
    },
  },
  {
    id: 'scheme-b',
    label: 'peak-offpeak-2026-08-17',
    effectiveFrom: SCHEME_B_EFFECTIVE_FROM,
    peak: [
      { start: 1, end: 4 },
      { start: 6, end: 10 },
    ],
    models: {
      'deepseek-v4-flash': {
        cny: { miss: 3, hit: 0.1, output: 9 },
        usd: { miss: 0.44, hit: 0.014, output: 1.32 },
      },
      'deepseek-v4-pro': {
        cny: { miss: 9, hit: 0.3, output: 27 },
        usd: { miss: 1.32, hit: 0.044, output: 3.96 },
      },
      'deepseek-chat': {
        cny: { miss: 2, hit: 0.5, output: 8 },
        usd: { miss: 0.27, hit: 0.07, output: 1.1 },
        flat: true,
      },
      'deepseek-reasoner': {
        cny: { miss: 4, hit: 1, output: 16 },
        usd: { miss: 0.55, hit: 0.14, output: 2.19 },
        flat: true,
      },
    },
  },
]

/** Apply user custom-price overrides onto a catalog copy. */
export function withCustomPrices(
  schemes: PriceScheme[],
  custom: Record<string, ModelPrice> | undefined,
): PriceScheme[] {
  if (custom === undefined || Object.keys(custom).length === 0) return schemes
  return schemes.map((scheme) => {
    const models = { ...scheme.models }
    for (const [raw, price] of Object.entries(custom)) {
      models[normalizeModel(raw)] = price
    }
    return { ...scheme, models }
  })
}

/** Parse a custom-prices JSON text; throws on invalid input. */
export function parseCustomPrices(text: string): Record<string, ModelPrice> {
  const trimmed = text.trim()
  if (trimmed === '') return {}
  const parsed: unknown = JSON.parse(trimmed)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('custom prices must be a JSON object keyed by model id')
  }
  const out: Record<string, ModelPrice> = {}
  for (const [raw, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = value as Partial<ModelPrice>
    const cny = entry.cny
    const usd = entry.usd
    if (
      typeof cny?.miss !== 'number' || typeof cny.hit !== 'number' || typeof cny.output !== 'number'
      || typeof usd?.miss !== 'number' || typeof usd.hit !== 'number' || typeof usd.output !== 'number'
      || cny.miss < 0 || cny.hit < 0 || cny.output < 0 || usd.miss < 0 || usd.hit < 0 || usd.output < 0
    ) {
      throw new Error(`custom price for "${raw}" needs cny/usd { miss, hit, output } numbers`)
    }
    out[normalizeModel(raw)] = {
      cny: { miss: cny.miss, hit: cny.hit, output: cny.output },
      usd: { miss: usd.miss, hit: usd.hit, output: usd.output },
      ...(entry.flat === true ? { flat: true } : {}),
    }
  }
  return out
}

/**
 * Pick the scheme a record bills under. Auto mode takes the newest scheme
 * whose effectiveFrom is not after the record time; a forced id applies that
 * scheme to every record (for comparison or pre-adaptation).
 */
export function resolveScheme(
  schemes: PriceScheme[],
  time: number,
  forcedId?: string,
): PriceScheme {
  if (forcedId !== undefined && forcedId !== 'auto') {
    const forced = schemes.find((scheme) => scheme.id === forcedId)
    if (forced !== undefined) return forced
  }
  let chosen = schemes[0]
  for (const scheme of schemes) {
    if (scheme.effectiveFrom <= time) chosen = scheme
    else break
  }
  return chosen
}

/** Whether a UTC instant falls inside a scheme's peak window. */
export function isPeakHour(scheme: PriceScheme, time: number): boolean {
  if (scheme.peak === undefined || scheme.peak.length === 0) return false
  const hour = Math.floor(((time % 86_400_000) + 86_400_000) % 86_400_000 / 3_600_000)
  for (const window of scheme.peak) {
    if (window.start <= hour && hour < window.end) return true
  }
  return false
}

/** What one record cost, in both currencies, under the resolved scheme. */
export interface RecordCost {
  costCny: number
  costUsd: number
  schemeId: string
  /** True while the record billed at a peak rate; false on off-peak; null when flat. */
  peak: boolean | null
}

/** Price a usage record; null when no catalog entry covers its model. */
export function priceRecord(
  record: UsageRecord,
  schemes: PriceScheme[],
  forcedId?: string,
): RecordCost | null {
  const scheme = resolveScheme(schemes, record.time, forcedId)
  const entry = scheme.models[normalizeModel(record.model)]
  if (entry === undefined) return null
  const peak = scheme.peak !== undefined && !entry.flat && isPeakHour(scheme, record.time)
  const factor = peak ? 1 : 0.5
  // When the scheme is flat or the model is flat, factor must be 1.
  const multiplier = (scheme.peak !== undefined && !entry.flat) ? factor : 1
  const scale = (n: number): number => n / 1_000_000 * multiplier
  return {
    costCny: scale(record.inputTokens * entry.cny.miss + record.cacheReadTokens * entry.cny.hit + record.outputTokens * entry.cny.output),
    costUsd: scale(record.inputTokens * entry.usd.miss + record.cacheReadTokens * entry.usd.hit + record.outputTokens * entry.usd.output),
    schemeId: scheme.id,
    peak: scheme.peak !== undefined && !entry.flat ? peak : null,
  }
}

/** Build totals over records, pricing each with the active catalog. */
export function totalsFor(
  records: UsageRecord[],
  schemes: PriceScheme[],
  forcedId?: string,
): { totals: import('./protocol.ts').CostTotals; priced: number } {
  let recordsCount = 0
  let inputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  let costCny = 0
  let costUsd = 0
  let priced = 0
  for (const record of records) {
    recordsCount += 1
    inputTokens += record.inputTokens
    cacheReadTokens += record.cacheReadTokens
    cacheWriteTokens += record.cacheWriteTokens
    outputTokens += record.outputTokens
    reasoningTokens += record.reasoningTokens
    const cost = priceRecord(record, schemes, forcedId)
    if (cost !== null) {
      priced += 1
      costCny += cost.costCny
      costUsd += cost.costUsd
    }
  }
  const billedInput = inputTokens + cacheReadTokens
  return {
    totals: {
      records: recordsCount,
      inputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      outputTokens,
      reasoningTokens,
      cacheHitRate: billedInput > 0 ? cacheReadTokens / billedInput : 0,
      costCny,
      costUsd,
    },
    priced,
  }
}
