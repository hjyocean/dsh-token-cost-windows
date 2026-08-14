# @deepseek-ai/dsh-token-cost

Token usage (input/output), cache hit/miss and cost statistics for DeepSeek Harness (DSH) Web GUI, per conversation and in aggregate — with a pricing engine that switches billing schemes automatically when DeepSeek changes prices.

## What it gives you

- **Per-conversation view**: a cost chip in the composer dock (next to the shipped `Input ~7.9K tok · Output ~12 tok` line) shows the current session's cost and cache hit rate; clicking it opens the per-request detail modal.
- **Overall summary** (Settings > Plugin configuration > Web UI plugins > Token Cost): time-filtered totals with today / yesterday / last 7 days / last 30 days / this month / last month / custom (up to 30 days), grouped by model, session and day.
- **Pricing status**: which scheme is billing now and when the next scheme kicks in.

## Data source

The plugin reads DSH's durable session logs (`$DSH_HOME/sessions/<cwd>/<session-id>/session.jsonl.zstd`) and folds the provider-reported usage events into per-request billing records (last-wins per turn/step, mirroring the harness token-meter projection). A compact ledger (`$DSH_HOME/storages/dsh-token-cost/ledger.json`) caches parsed records; only changed logs are re-parsed, so queries stay cheap while a session streams. zstd decoding uses [fzstd](https://github.com/101arrowz/fzstd) (pure JS, zero deps).

Token fields follow the harness convention: `inputTokens` = cache-miss prompt tokens, `cacheReadTokens` = cache-hit prompt tokens (disjoint; together they are the billed input).

## Pricing engine (dual schemes, auto switch)

Built-in catalog from the official pricing page (api-docs.deepseek.com/quick_start/pricing, fetched 2026-08-14):

- **Scheme A** (flat, until 2026-08-16T16:00Z): deepseek-v4-flash / v4-pro flat prices in CNY and USD; legacy deepseek-chat / deepseek-reasoner at their flat rates.
- **Scheme B** (peak/off-peak, from 2026-08-16T16:00Z = 2026-08-17 00:00 Beijing time): peak hours UTC 01–04 and 06–10 (Beijing 9–12, 14–18), off-peak at half price. Covers deepseek-v4-flash / v4-pro; legacy models stay flat.

Billing picks, per record, the newest scheme whose `effectiveFrom` is not after the record time. **When DeepSeek changes prices again, adding one scheme entry is the whole adaptation — no plugin update needed.** You can also force a scheme (`priceMode`), override or add model prices (`customPrices` JSON), and switch the display currency (CNY/USD).

Cost = miss/1e6 × miss price + hit/1e6 × hit price + output/1e6 × output price (per-1M-token rates).

> Note: figures are an estimate from provider-reported usage; always reconcile against the official billing page. Day bucketing follows your browser timezone, so a conversation crossing midnight splits on your local days. Requests made with the same API key OUTSIDE DSH (other tools/processes) never enter DSH session logs and are not counted.

## Installation

Install the family aggregate package (all plugins in one) or this plugin alone:

```sh
# standalone
dsh plugin --profile web add link:/path/to/dsh-web-ui/packages/dsh-token-cost
# or via the aggregate
dsh plugin --profile web add link:/path/to/dsh-web-ui/packages/dsh-web-ui-all
```

Restart `dsh web`, open the settings page and expand "Web UI plugins". The plugin reads usage starting from the first query — existing session logs are backfilled automatically.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch (dock chip + summary card) |
| `currency` | 'cny' | 'usd' | `'cny'` | Display currency |
| `priceMode` | 'auto' | 'scheme-a' | 'scheme-b' | `'auto'` | Auto switches by record time |
| `customPrices` | string (JSON) | `''` | Per-model price overrides |
| `keyAliases` | string (JSON) | `''` | Provider > API key alias map |

All editable from the card's Settings tab; a "Rescan session logs" action forces a full re-parse.

## Development

```sh
pnpm install && pnpm -r build
pnpm --filter @deepseek-ai/dsh-token-cost test
pnpm --filter @deepseek-ai/dsh-token-cost typecheck
```

See DESIGN.md for the architecture.