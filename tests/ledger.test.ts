/**
 * Ledger tests: incremental sync over real zstd session-log files.
 */

import { copyFileSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SessionLedger } from '../src/ledger.ts'

/** Committed zstd fixtures: session-a bills 100 input tokens, session-b 200. */
const FIXTURE_A = join(__dirname, 'fixtures', 'session-a.jsonl.zstd')
const FIXTURE_B = join(__dirname, 'fixtures', 'session-b.jsonl.zstd')

describe('SessionLedger', () => {
  it('parses new sessions, skips unchanged files, and re-parses changed ones', async () => {
    const root = mkdtempSync(join(tmpdir(), 'token-cost-test-'))
    const dir = join(root, '--tmp--')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(dir, 'session-abc'), { recursive: true })
    const file = join(dir, 'session-abc', 'session.jsonl.zstd')
    copyFileSync(FIXTURE_A, file)

    const ledger = new SessionLedger(root, join(root, 'ledger.json'))
    const first = await ledger.sync()
    expect(first.sessionCount).toBe(1)
    expect(first.recordCount).toBe(1)
    const session = ledger.session('session-abc')
    expect(session!.records[0]!.inputTokens).toBe(100)

    // Unchanged file: sync must not re-parse (mtime/size identical).
    await ledger.sync()
    expect(ledger.stats().recordCount).toBe(1)

    // Changed file: re-parse picks the new usage up. The fixture copy lands
    // within the same filesystem timestamp tick on Windows (mtimeMs equal),
    // so bump the mtime to simulate a genuinely changed file.
    copyFileSync(FIXTURE_B, file)
    const later = new Date(Date.now() + 1_000)
    utimesSync(file, later, later)
    await ledger.sync()
    expect(ledger.session('session-abc')!.records[0]!.inputTokens).toBe(200)
  })
})