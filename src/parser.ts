/**
 * Pure parser for DSH session logs (the zstd-compressed JSONL event stream
 * under `$DSH_HOME/sessions/<cwd-slug>/<session-id>/session.jsonl.zstd`).
 *
 * Billing-relevant events:
 * - `request/context` (`{provider, model}`) and `request/header`
 *   (`header.config.{provider, model}`) set the model of the current request;
 * - `assistant/chunk` with `chunk.type === 'usage'` reports per-step usage;
 * - `assistant/message` carries the final usage for the same turn/step.
 *
 * Per (turn, step) the LAST usage wins (message overrides the chunk sample),
 * mirroring the harness token-meter projection, so a step is never double
 * counted.
 */

import type { SessionMeta, UsageRecord } from './protocol.ts'

export interface ParsedSession {
  meta: SessionMeta
  records: UsageRecord[]
}

/** Dedupe key for one step's usage. */
function stepKey(turn: number | undefined, step: number | undefined): string {
  return `${turn ?? 0}:${step ?? 0}`
}

/** Parse one session log text into meta + per-step usage records. */
export function parseSessionLog(text: string, sessionId: string, fallbackCwd: string): ParsedSession {
  let createdAt = 0
  let cwd = fallbackCwd
  let title = ''
  let lastActivity = 0
  let provider = ''
  let model = ''
  const byStep = new Map<string, UsageRecord>()

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const time = typeof event.time === 'number' ? event.time : 0
    if (time > lastActivity) lastActivity = time
    switch (event.type) {
      case 'session': {
        // The session envelope carries createdAt/cwd at the top level.
        if (typeof event.createdAt === 'number' && event.createdAt > 0) createdAt = event.createdAt
        if (typeof event.cwd === 'string' && event.cwd !== '') cwd = event.cwd
        break
      }
      case 'session/title': {
        const data = event.data as Record<string, unknown> | undefined
        if (typeof data?.title === 'string' && data.title !== '') title = data.title
        break
      }
      case 'request/context': {
        const data = event.data as Record<string, unknown> | undefined
        if (typeof data?.model === 'string' && data.model !== '') {
          model = data.model
          if (typeof data.provider === 'string') provider = data.provider
        }
        break
      }
      case 'request/header': {
        const header = (event.data as Record<string, unknown> | undefined)?.header as
          | Record<string, unknown>
          | undefined
        const config = header?.config as Record<string, unknown> | undefined
        if (typeof config?.model === 'string' && config.model !== '') {
          model = config.model
          if (typeof config.provider === 'string') provider = config.provider
        }
        break
      }
      case 'assistant/chunk': {
        const data = event.data as Record<string, unknown> | undefined
        const chunk = data?.chunk as Record<string, unknown> | undefined
        if (chunk?.type !== 'usage') break
        recordStep(data, chunk.usage, time)
        break
      }
      case 'assistant/message': {
        const data = event.data as Record<string, unknown> | undefined
        if (data?.usage === undefined) break
        recordStep(data, data.usage, time)
        break
      }
    }
  }

  function recordStep(
    data: Record<string, unknown> | undefined,
    usage: unknown,
    time: number,
  ): void {
    const u = usage as Record<string, unknown> | undefined
    if (u === undefined) return
    const turn = typeof data?.turn === 'number' ? data.turn : 0
    const step = typeof data?.step === 'number' ? data.step : 0
    const key = stepKey(turn, step)
    const previous = byStep.get(key)
    byStep.set(key, {
      time: Math.max(previous?.time ?? 0, time),
      turn,
      step,
      sessionId,
      sessionLabel: title !== '' ? title : sessionId,
      provider: provider || previous?.provider || '',
      model: model || previous?.model || '',
      inputTokens: toCount(u.inputTokens, previous?.inputTokens),
      cacheReadTokens: toCount(u.cacheReadTokens, previous?.cacheReadTokens),
      cacheWriteTokens: toCount(u.cacheWriteTokens, previous?.cacheWriteTokens),
      outputTokens: toCount(u.outputTokens, previous?.outputTokens),
      reasoningTokens: toCount(u.reasoningTokens, previous?.reasoningTokens),
    })
  }

  const records = [...byStep.values()].sort((a, b) => a.time - b.time)
  return {
    meta: {
      sessionId,
      cwd,
      title,
      createdAt,
      lastActivity,
    },
    records,
  }
}

function toCount(value: unknown, fallback: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : (fallback ?? 0)
}