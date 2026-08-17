/**
 * Browser-half entry for the dsh-token-cost plugin — runs inside the dsh web
 * GUI. Registers the per-session cost chip in the composer dock (next to the
 * shipped Input/Output stats line) and the summary dashboard card in the
 * settings page's Web UI plugin group. Mounting problems are logged, never
 * thrown: an external plugin must not take the GUI down.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the locale namespace map and the slot registry merge.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the conversation slot declarations (composer.dock) and the
// settings-surface SlotMap members (settingsScope, settings.plugin.item).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { StatsCostBridge, type StatsCostBridgeFace } from './stats/StatsCostBridge.tsx'
import { en, zh, type TokenCostKey } from './locales.ts'
import {
  TokenCostSettingsCard,
  type TokenCostSettingsCardFace,
} from './settings/TokenCostSettingsCard.tsx'
import { TOKEN_COST_NS, type TokenCostSettings } from './settings-schema.ts'

/** Locale namespace this plugin owns. */
const NS = 'token-cost'

/** Style tag id for the chat-width override (kept idempotent). */
const CHAT_WIDTH_STYLE_ID = 'dsh-token-cost-chat-width'

/**
 * Force the conversation column to full width. The shell defines
 * `--dsh-chat-content-width` on its conversation root; a universal
 * `!important` declaration overrides that variable wherever it is set, so
 * every consumer (message column, empty-state card, composer card) resolves
 * to 100% and the DSH upgrade cannot silently revert the width.
 */
function applyChatWidthCss(width: 'wide' | 'default'): void {
  const existing = document.getElementById(CHAT_WIDTH_STYLE_ID)
  if (width !== 'wide') {
    existing?.remove()
    return
  }
  if (existing !== null) return
  const style = document.createElement('style')
  style.id = CHAT_WIDTH_STYLE_ID
  style.textContent = '*{--dsh-chat-content-width:100%!important}'
  document.head.appendChild(style)
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-token-cost surface copy. */
    'token-cost': TokenCostKey
  }
}
/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

/**
 * Mount the two dsh-token-cost surfaces: the composer-dock chip and the
 * settings-page summary card. Both read the same settings scope.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'token-cost: dictionaries')

  const scope = ctx.settingsScope.bind<TokenCostSettings>({ namespace: TOKEN_COST_NS })

  // Chat width follows the settings section live: react to edits, and clean
  // the injected style on teardown.
  let unsubscribeWidth: (() => void) | undefined
  try {
    const applyWidth = (): void => {
      const value = scope.getSnapshot().value
      applyChatWidthCss(value?.chatWidth ?? 'wide')
    }
    unsubscribeWidth = scope.subscribe(applyWidth)
    applyWidth()
  } catch (error) {
    console.warn('[dsh-token-cost] chat-width mount failed:', error)
  }

  const disposers: Array<() => void> = []
  try {
    disposers.push(ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
      name: 'conversation.composer.dock',
      id: 'token-cost',
      order: 110,
      locale: NS,
      inject: (): StatsCostBridgeFace => ({ settings: scope }),
    }, StatsCostBridge)))
    disposers.push(ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'token-cost',
      order: 40,
      label: 'Token 费用统计',
      locale: NS,
      inject: (): TokenCostSettingsCardFace => ({ settings: scope }),
    }, TokenCostSettingsCard)))
  } catch (error) {
    console.warn('[dsh-token-cost] mount failed:', error)
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
    unsubscribeWidth?.()
  }, 'token-cost: ui mounts')
}