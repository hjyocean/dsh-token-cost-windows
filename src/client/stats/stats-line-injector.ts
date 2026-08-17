/**
 * Stats-line cost injector: inserts the current session's total cost into
 * the official conversation stats line, right between the speed group
 * ("首 token 平均 Xs · Y tok/s") and the cache-hit group ("缓存命中 Z%").
 *
 * The injected span carries no own styling: it inherits the stats line's
 * fonts and colors exactly (same as every other group span). A Mutation
 * observer re-applies the injection after every React re-render of the
 * line, and the operation is idempotent (a data marker identifies our
 * nodes).
 */

import { formatMoney } from '../format.ts'

/** Marker identifying injected nodes (removed before re-inject). */
export const COST_NODE_MARKER = 'data-dsh-token-cost-price'

/** Marker identifying injected balance nodes. */
export const BALANCE_NODE_MARKER = 'data-dsh-token-cost-balance'

/** The current cost text the bridge computed (empty while unknown). */
export interface CostBridgeState {
  /** Formatted cost for the active currency, e.g. '¥0.12'; empty when unknown. */
  costText: string
  /** True while the plugin is disabled by settings. */
  disabled: boolean
  /** Owning session id (for the click-through detail modal). */
  sessionId?: string
  /** Display currency (for the click-through detail modal). */
  currency?: 'cny' | 'usd'
  /**
   * Formatted balance value, e.g. '¥5.79' (or a status word like '查询中…').
   * Empty/absent hides the balance group entirely.
   */
  balanceText?: string
}

let current: CostBridgeState = { costText: '', disabled: false }

/** Click handler the bridge registers to open the session detail modal. */
let openDetail: ((sessionId: string) => void) | null = null

/** Click handler the bridge registers to refresh the account balance. */
let refreshBalance: (() => void) | null = null

/** Register the modal opener (the bridge component owns the modal). */
export function registerDetailOpener(opener: (sessionId: string) => void): void {
  openDetail = opener
}

/** Register the balance refresher (the bridge component owns the query). */
export function registerBalanceRefresher(refresher: (() => void) | null): void {
  refreshBalance = refresher
}

/** Publish a new bridge state (called by the dock bridge component). */
export function publishCostState(state: CostBridgeState): void {
  current = state
  // Data arrived without a DOM mutation: apply immediately (idempotent).
  scheduleApply()
}

/** The latest published state. */
export function costBridgeState(): CostBridgeState {
  return current
}

/** Locale evidence inside the line: which language is the line speaking? */
function lineIsChinese(line: string): boolean {
  return line.includes('缓存命中')
}

/**
 * The official stats line sits inside the composer card (the dock footer of
 * the input bar). Anchor on the composer textarea and walk UP its ancestor
 * chain: the first ancestor that also contains the cache-hit copy is the
 * card, and inside it the cache-hit span is unambiguous (message bodies are
 * siblings, never ancestors, of the textarea).
 */
function locateLine(): { root: HTMLElement; anchor: HTMLElement } | null {
  const textarea = document.querySelector('textarea')
  if (textarea === null) return null
  let container: HTMLElement | null = textarea.parentElement
  while (container !== null && container !== document.body) {
    const text = container.textContent ?? ''
    if (
      (text.includes('缓存命中') || text.includes('Cache hit'))
      && text.includes('tok/s')
    ) {
      const found = findCacheAnchor(container)
      if (found !== null) return found
    }
    container = container.parentElement
  }
  return null
}

/** Find the cache-hit span inside a container and verify the stats-line shape. */
function findCacheAnchor(container: HTMLElement): { root: HTMLElement; anchor: HTMLElement } | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let cursor: Node | null = walker.nextNode()
  while (cursor !== null) {
    const text = cursor.textContent ?? ''
    if (text.includes('缓存命中') || text.includes('Cache hit')) {
      const anchor = cursor.parentElement
      if (anchor !== null) {
        const root = anchor.parentElement
        const rootText = root?.textContent ?? ''
        // The official stats line is a short row of plain group spans
        // separated by "|" spans (children are ALL spans).
        const children = root === null ? [] : [...root.children]
        if (
          root !== null
          && children.length >= 3
          && children.every((child) => child.tagName === 'SPAN')
          && rootText.length < 200
        ) {
          return { root, anchor }
        }
      }
    }
    cursor = walker.nextNode()
  }
  return null
}

/**
 * Apply the injection (idempotent): remove stale nodes, then place the cost
 * group (and, when present, the balance group) right before the cache-hit
 * span, cloning the official separator so spacing matches the line exactly.
 */
function applyInjection(
  root: HTMLElement,
  anchor: HTMLElement,
  costText: string,
  chinese: boolean,
  state: CostBridgeState,
): void {
  root.querySelectorAll(`[${COST_NODE_MARKER}]`).forEach((el) => el.remove())
  root.querySelectorAll(`[${BALANCE_NODE_MARKER}]`).forEach((el) => el.remove())
  const sep = anchor.previousElementSibling
  const label = chinese ? '费用' : 'Cost'
  const group = document.createElement('span')
  group.setAttribute(COST_NODE_MARKER, 'group')
  group.textContent = `${label} ${costText}`
  // Click-through: open the session detail modal when the bridge is mounted.
  if (state.sessionId !== undefined && openDetail !== null) {
    group.style.cursor = 'pointer'
    group.style.textDecoration = 'underline dotted'
    group.title = '查看费用明细'
    group.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openDetail?.(state.sessionId as string)
    })
  }
  if (sep !== null && sep.textContent === '|' && sep.tagName === 'SPAN') {
    // The official separator before the cache-hit span now separates the
    // cost group; give the cache-hit group a cloned separator of its own.
    const sepClone = sep.cloneNode(true) as HTMLElement
    sepClone.setAttribute(COST_NODE_MARKER, 'sep')
    // Balance group rides right after the cost group (same separator rhythm).
    const nodes: Array<Node | string> = [' ', group]
    if (state.balanceText !== undefined && state.balanceText !== '') {
      const balanceSep = sep.cloneNode(true) as HTMLElement
      balanceSep.setAttribute(BALANCE_NODE_MARKER, 'sep')
      nodes.push(' ', balanceSep, ' ', makeBalanceGroup(chinese, state.balanceText))
    }
    nodes.push(' ', sepClone)
    anchor.before(...nodes)
  } else {
    anchor.before(group)
  }
}

/** Build the balance span: shows the current balance, click to refresh. */
function makeBalanceGroup(chinese: boolean, text: string): HTMLElement {
  const label = chinese ? '余额' : 'Balance'
  const group = document.createElement('span')
  group.setAttribute(BALANCE_NODE_MARKER, 'group')
  group.textContent = `${label} ${text}`
  group.style.cursor = 'pointer'
  group.style.textDecoration = 'underline dotted'
  group.title = chinese ? '点击刷新余额' : 'Click to refresh balance'
  group.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    refreshBalance?.()
  })
  return group
}

let scheduled = 0

/** Apply the current state once, coalesced to a frame (no-op when nothing to inject). */
function scheduleApply(): void {
  if (scheduled !== 0) return
  scheduled = window.requestAnimationFrame(() => {
    scheduled = 0
    applyNow()
  })
}

/** Apply the current state immediately. */
function applyNow(): void {
  const state = current
  if (state.disabled || state.costText === '') {
    // Stale nodes must not linger when the data went away.
    document.querySelectorAll(`[${COST_NODE_MARKER}]`).forEach((el) => el.remove())
    document.querySelectorAll(`[${BALANCE_NODE_MARKER}]`).forEach((el) => el.remove())
    return
  }
  const located = locateLine()
  if (located === null) return
  const { root, anchor } = located
  const chinese = lineIsChinese(root.textContent ?? '')
  const existing = anchor.previousElementSibling
  if (existing !== null && existing.hasAttribute(COST_NODE_MARKER)) {
    // Already injected: the idempotent guard must not swallow later updates
    // (the balance data lands after the initial injection). Update in place.
    updateInjection(root, state, chinese)
    return
  }
  applyInjection(root, anchor, state.costText, chinese, state)
}

/**
 * Refresh an already-injected stats line in place: cost text, and the
 * balance group (update, insert when it just became visible, or remove when
 * it went away). Never rebuilds the whole line, so the injected nodes keep
 * their identity across the shell's re-renders.
 */
function updateInjection(root: HTMLElement, state: CostBridgeState, chinese: boolean): void {
  const label = chinese ? '费用' : 'Cost'
  const costGroup = root.querySelector(`[${COST_NODE_MARKER}="group"]`)
  if (costGroup !== null) costGroup.textContent = `${label} ${state.costText}`

  const wantBalance = state.balanceText !== undefined && state.balanceText !== ''
  const balanceGroup = root.querySelector(`[${BALANCE_NODE_MARKER}="group"]`)
  if (wantBalance && balanceGroup !== null) {
    balanceGroup.textContent = `${chinese ? '余额' : 'Balance'} ${state.balanceText}`
    return
  }
  if (!wantBalance && balanceGroup !== null) {
    const sep = balanceGroup.previousElementSibling
    if (sep !== null && sep.hasAttribute(BALANCE_NODE_MARKER)) sep.remove()
    balanceGroup.remove()
    return
  }
  if (wantBalance && balanceGroup === null) {
    const balanceText = state.balanceText
    if (balanceText === undefined || balanceText === '') return
    const sepClone = root.querySelector(`[${COST_NODE_MARKER}="sep"]`)
    if (sepClone === null) return
    const balanceSep = sepClone.cloneNode(true) as HTMLElement
    balanceSep.removeAttribute(COST_NODE_MARKER)
    balanceSep.setAttribute(BALANCE_NODE_MARKER, 'sep')
    sepClone.before(' ', balanceSep, ' ', makeBalanceGroup(chinese, balanceText))
  }
}

let observer: MutationObserver | null = null

/** Start observing and injecting; safe to call repeatedly. */
export function startStatsLineInjector(): void {
  if (observer !== null) return
  observer = new MutationObserver(() => {
    scheduleApply()
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

/** Stop observing (teardown). */
export function stopStatsLineInjector(): void {
  if (observer !== null) {
    observer.disconnect()
    observer = null
  }
  document.querySelectorAll(`[${COST_NODE_MARKER}]`).forEach((el) => el.remove())
  document.querySelectorAll(`[${BALANCE_NODE_MARKER}]`).forEach((el) => el.remove())
}

/** Format a totals pair into the display cost text. */
export function formatCostText(costCny: number, costUsd: number, currency: 'cny' | 'usd'): string {
  return formatMoney(currency === 'cny' ? costCny : costUsd, currency)
}