# dsh-token-cost

<p align="center">
  <strong>English</strong> · <a href="README.md">中文</a>
</p>

Token usage (input/output), cache hit/miss and cost statistics for DeepSeek Harness (DSH) Web GUI, per conversation and in aggregate — with a pricing engine that switches billing schemes automatically when DeepSeek changes prices.

## What it gives you

- **Per-conversation view**: the session's total cost is embedded directly into the official stats line at the bottom of the conversation (right after `TTFT avg … · … tok/s`); clicking it opens the per-request detail modal (time / model / cache miss / cache hit / output / cost, newest first).

<p align="center">
  <img src="docs/screenshots/conversation-bottom.png" alt="Cost in the conversation stats line" width="90%">
</p>

<p align="center">
  <img src="docs/screenshots/cost-detail.png" alt="Cost detail modal" width="80%">
</p>

- **Account balance**: right next to the cost on the same stats line, the current provider's account balance (e.g. `Balance ¥41.82`), auto-refreshed every 5 minutes; click to refresh immediately. Providers without balance support show a status word instead.
- **Conversation width**: force the conversation column to full window width, or back to the official 748px column; both widths are injected by the plugin, independent of the DSH bundle, and survive DSH upgrades.

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
dsh plugin --profile web add github:le-soleil-se-couche/dsh-token-cost
# or via the aggregate
（或安装后通过 dsh-web-ui-all 聚合包使用）
```

Restart `dsh web`, open the settings page and expand "Web UI plugins". The plugin reads usage starting from the first query — existing session logs are backfilled automatically.

## Updating

When developing locally (installed via `link:`), rebuild and the change applies by scope:

```sh
cd <plugin-dir>
pnpm build        # regenerate lib/
```

- **UI changes** (balance, width, cards…): the built-in client-hmr hot-reloads the browser; hard-refresh if it does not.
- **Host changes** (routes, settings): restart `dsh web`.
- **package.json changed** (new/changed dependencies): `pnpm install`, then re-run `dsh plugin --profile web add <plugin-dir>`, then restart `dsh web`.
- **Pulled new code from git**: `git pull` → `pnpm install` → `pnpm build` → re-run `dsh plugin --profile web add <plugin-dir>`.

For packages installed from a registry (npm / github), follow DSH's plugin docs (`dsh plugin --profile web update <pkg>` or reinstall at a newer version).

## Changes vs upstream

This repository is forked from [le-soleil-se-couche/dsh-token-cost](https://github.com/le-soleil-se-couche/dsh-token-cost) at `9a7c183`. Changes on top of upstream:

- **Account balance**: new `/api/dsh-token-cost/balance` route plus a balance chip in the conversation stats line (5-minute auto refresh, click to refresh). The key is resolved through the `credentials` service inside the host process and never leaves it.
- **Conversation width**: new `chatWidth` setting that overrides DSH's built-in width variable (survives DSH upgrades).
- **Windows path compatibility**: `ledger.ts` used `split('/')` / `lastIndexOf('/')`, which only understand forward slashes; now both `\` and `/` work — fixing all session ids collapsing to `session-unknown` and the ledger.json persist failure (`mkdir ''`) on Windows.
- **DSH rc.6 slot rename**: the settings card slot changed from `web-ui.plugin.item` to `settings.plugin.item` (the upstream name does not exist on rc.6; the Plugins configuration area is three-tier: `settings.section` (nav entry) > `settings.plugins.tab` (tabs: plugin list / configurable) > `settings.plugin.item` (cards inside the configurable tab). The card registers into `settings.plugin.item` and shows under Settings > Plugins > Configurable).
- **DSH rc.6 settings-exposure patch (required)**: DSH's `dsh-host-apiproxy` decides which settings namespaces are exposed to configuration clients via a hard-coded whitelist `WEB_SETTINGS_NAMESPACES` (plugins cannot declare exposure themselves; the code comment marks it as deferred work). Without `token-cost` in the whitelist, this plugin's settings are invisible to the client and writes are silently dropped (saving appears to work, then reverts). **Add `"token-cost"` to the `WEB_SETTINGS_NAMESPACES` array in `@deepseek-ai/dsh-host-apiproxy/lib/index.js`** (this machine: `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js`). **DSH upgrades overwrite this file — re-apply the patch after upgrading.**
- **Tests**: ledger test adapted to Windows filesystem timestamp precision (CopyFile preserves the source mtime, which defeated the `(mtimeMs, size)` change detection).

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch (stats-line cost + summary card) |
| `currency` | 'cny' | 'usd' | `'cny'` | Display currency |
| `priceMode` | 'auto' | 'scheme-a' | 'scheme-b' | `'auto'` | Auto switches by record time |
| `customPrices` | string (JSON) | `''` | Per-model price overrides |
| `chatWidth` | 'wide' | 'default' | `'wide'` | Conversation width: `wide` = full width, `default` = official 748px column (both injected by the plugin, independent of the DSH bundle) |
| `keyAliases` | string (JSON) | `''` | Provider > API key alias map |

All editable from the card's Settings tab; a "Rescan session logs" action forces a full re-parse.

## Development

```sh
pnpm install && pnpm -r build
pnpm --filter @deepseek-ai/dsh-token-cost test
pnpm --filter @deepseek-ai/dsh-token-cost typecheck
```

See DESIGN.md for the architecture.

---

*[中文版本](README.md)*