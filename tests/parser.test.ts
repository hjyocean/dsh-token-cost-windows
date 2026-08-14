/**
 * Session-log parser tests: usage folding per (turn, step) with last-wins,
 * model attribution from request/context, and session meta extraction.
 */

import { describe, expect, it } from 'vitest'
import { parseSessionLog } from '../src/parser.ts'

const LOG = [
  JSON.stringify({ type: 'session', version: 0, id: 'session-abc', createdAt: 1_700_000_000_000, cwd: '/tmp/work' }),
  JSON.stringify({ type: 'session/title', seq: 1, time: 1_700_000_000_100, data: { title: '成本统计' } }),
  JSON.stringify({ type: 'request/context', seq: 2, time: 1_700_000_000_200, data: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }),
  JSON.stringify({ type: 'assistant/chunk', seq: 3, time: 1_700_000_000_300, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 5000 } } } }),
  JSON.stringify({ type: 'assistant/message', seq: 4, time: 1_700_000_000_400, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 120, cacheReadTokens: 5000, reasoningTokens: 30 } } }),
  JSON.stringify({ type: 'request/context', seq: 5, time: 1_700_000_000_500, data: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } }),
  JSON.stringify({ type: 'assistant/message', seq: 6, time: 1_700_000_000_600, data: { turn: 2, step: 1, usage: { inputTokens: 2000, outputTokens: 50 } } }),
  'not json line',
].join('\n')

describe('parseSessionLog', () => {
  it('extracts meta and folds per-step usage with last-wins', () => {
    const parsed = parseSessionLog(LOG, 'session-abc', '')
    expect(parsed.meta.sessionId).toBe('session-abc')
    expect(parsed.meta.cwd).toBe('/tmp/work')
    expect(parsed.meta.title).toBe('成本统计')
    expect(parsed.meta.createdAt).toBe(1_700_000_000_000)
    expect(parsed.meta.lastActivity).toBe(1_700_000_000_600)
    expect(parsed.records).toHaveLength(2)
  })

  it('the message usage replaces the chunk sample for the same step', () => {
    const parsed = parseSessionLog(LOG, 'session-abc', '')
    const first = parsed.records[0]!
    expect(first.turn).toBe(1)
    expect(first.outputTokens).toBe(120)
    expect(first.reasoningTokens).toBe(30)
    expect(first.cacheReadTokens).toBe(5000)
    expect(first.inputTokens).toBe(1000)
  })

  it('attributes each step to its request model', () => {
    const parsed = parseSessionLog(LOG, 'session-abc', '')
    expect(parsed.records[0]!.model).toBe('deepseek-v4-flash')
    expect(parsed.records[1]!.model).toBe('deepseek-v4-pro')
  })

  it('tolerates garbage lines and empty input', () => {
    const parsed = parseSessionLog(LOG, 'session-abc', '')
    expect(parsed.records).toHaveLength(2)
    expect(parseSessionLog('', 'x', '').records).toHaveLength(0)
  })
})
