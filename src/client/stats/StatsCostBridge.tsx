/**
 * Stats cost bridge: a renderless composer-dock entry that feeds the
 * official stats line with the current session's total cost and the
 * provider's account balance.
 *
 * It renders nothing of its own (the dock row stays exactly as the shell
 * paints it); its effect polls the host session route and publishes the
 * formatted cost (and, on a slower cadence, the account balance) into the
 * stats-line injector, which places them between the speed group and the
 * cache-hit group of the official line.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { BalanceResponse, SessionDetailResponse } from '../../protocol.ts'
import { TokenCostApi } from '../api.ts'
import { SessionDetailModal } from '../shared/SessionDetailModal.tsx'
import { resolveSettings, useSettingsValue, type TokenCostSettings } from '../settings-schema.ts'
import type { TokenCostKey } from '../locales.ts'
import {
  formatCostText,
  publishCostState,
  registerBalanceRefresher,
  registerDetailOpener,
  startStatsLineInjector,
} from './stats-line-injector.ts'

/** The bridge's injected share: the bound settings scope for currency. */
export interface StatsCostBridgeFace {
  settings: SettingsScope<TokenCostSettings>
}

/** Full props the renderer binds for a composer.dock entry. */
export type StatsCostBridgeProps =
  PropsRuntime<'conversation.composer.dock'>
  & PropsLocale<'token-cost'>
  & InjectFace<StatsCostBridgeFace>

/** Poll interval for the session cost (same cadence as the shell's stats). */
const POLL_MS = 10_000

/** Poll interval for the account balance. */
const BALANCE_REFRESH_MS = 5 * 60 * 1_000

/**
 * Format one balance payload for the compact stats-line group: a currency
 * figure when the provider reports one, or a short status word otherwise.
 */
export function balanceDisplayText(
  response: BalanceResponse,
  t: (key: TokenCostKey) => string,
): string {
  if (!response.supported) return t('balance.unsupported')
  if (response.totalBalance === undefined || response.totalBalance === '') return t('balance.unknown')
  if (response.currency === 'CNY') return `¥${response.totalBalance}`
  return response.currency === undefined ? response.totalBalance : `${response.currency} ${response.totalBalance}`
}

/** Renderless bridge: data flows into the stats line, nothing is painted. */
export function StatsCostBridge(props: StatsCostBridgeProps) {
  const { sessionId } = props
  const raw = useSettingsValue(props.settings)
  const { enabled, currency } = resolveSettings(raw)
  const apiRef = useRef<TokenCostApi | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const costRef = useRef('')
  const balanceRef = useRef('')
  // t is recreated per render; keep the latest in a ref so the poll effect
  // (mounted once per session/enabled/currency) always formats fresh.
  const tRef = useRef(props.t)
  tRef.current = props.t

  /** Publish the latest cost + balance texts into the stats line. */
  const publish = useCallback((): void => {
    publishCostState({
      costText: costRef.current,
      disabled: !enabled,
      sessionId,
      currency,
      balanceText: balanceRef.current,
    })
  }, [enabled, sessionId, currency])

  useEffect(() => {
    startStatsLineInjector()
    registerDetailOpener((id) => { setOpenId(id) })
    costRef.current = ''
    balanceRef.current = ''
    publish()
    if (!enabled) return
    let alive = true
    const api = new TokenCostApi()
    apiRef.current = api
    const loadCost = (): void => {
      api.session(sessionId).then((response: SessionDetailResponse) => {
        if (!alive || !response.ok) return
        costRef.current = formatCostText(response.totals.costCny, response.totals.costUsd, currency)
        publish()
      }).catch(() => {
        // Transient host states self-heal on the next poll.
      })
    }
    const loadBalance = (): void => {
      balanceRef.current = tRef.current('balance.loading')
      publish()
      api.balance().then((response: BalanceResponse) => {
        if (!alive || !response.ok) return
        balanceRef.current = balanceDisplayText(response, tRef.current)
        publish()
      }).catch(() => {
        if (!alive) return
        balanceRef.current = tRef.current('balance.error')
        publish()
      })
    }
    registerBalanceRefresher(() => { if (alive) loadBalance() })
    loadCost()
    loadBalance()
    const costTimer = setInterval(loadCost, POLL_MS)
    const balanceTimer = setInterval(loadBalance, BALANCE_REFRESH_MS)
    return () => {
      alive = false
      clearInterval(costTimer)
      clearInterval(balanceTimer)
      registerBalanceRefresher(null)
      publishCostState({ costText: '', disabled: false })
    }
  }, [sessionId, enabled, currency, publish])

  return (
    <>
      {openId !== null ? (
        <SessionDetailModal
          sessionId={openId}
          api={apiRef.current ?? new TokenCostApi()}
          currency={currency}
          t={props.t}
          onClose={() => { setOpenId(null) }}
        />
      ) : null}
    </>
  )
}
