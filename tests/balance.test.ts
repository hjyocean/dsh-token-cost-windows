/**
 * Balance route tests: the /api/dsh-token-cost/balance handler resolves the
 * current provider's credential through the credentials seam (never reading
 * a raw key) and queries the DeepSeek balance API. Host services are faked
 * per scenario; the loopback fence and provider support matrix are covered.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { makeBalanceRoute } from '../src/routes.ts'

/** A loopback request that passes the fence (localhost, same origin). */
function makeReq(): IncomingMessage {
  return {
    method: 'GET',
    url: '/api/dsh-token-cost/balance',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      host: 'localhost:1234',
      'sec-fetch-site': 'same-origin',
      origin: 'http://localhost:1234',
    },
  } as unknown as IncomingMessage
}

/** A minimal ServerResponse capturing status + serialized body. */
function makeRes(): { res: ServerResponse; status: () => number; body: () => unknown } {
  let status = 0
  let body = ''
  const res = {
    writeHead: (code: number): void => { status = code },
    end: (chunk: string): void => { body = String(chunk) },
  } as unknown as ServerResponse
  return {
    res,
    status: () => status,
    body: () => JSON.parse(body) as unknown,
  }
}

/** Fake host services keyed by service name (ctx.get). */
function makeCtx(services: Record<string, unknown>): Context {
  return { get: (key: string): unknown => services[key] } as unknown as Context
}

/** Fake fetch response with the DeepSeek /user/balance shape. */
function fakeBalanceResponse(overrides: Record<string, unknown> = {}): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '5.79', granted_balance: '0.00', topped_up_balance: '5.79' }],
      ...overrides,
    }),
  } as unknown as Response
}

/** DeepSeek provider fully configured with an env-referenced key. */
function deepseekServices(apiKeyEnv = 'DEEPSEEK_API_KEY'): Record<string, unknown> {
  return {
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official' }) },
    llm: {
      listProviders: () => [{ id: 'deepseek-official' }],
      listConfigurableProviders: () => [
        { provider: 'deepseek-official', settingsNs: 'provider-deepseek-official', settingsPath: ['profile'] },
      ],
    },
    settings: {
      describe: () => [
        { ns: 'provider-deepseek-official', value: { profile: { apiKeyEnv, baseURL: 'https://api.deepseek.com' } } },
      ],
    },
    credentials: {
      resolve: async () => ({ value: 'sk-test-123', source: 'env' }),
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('makeBalanceRoute', () => {
  it('queries the DeepSeek balance API with the resolved credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeBalanceResponse())
    vi.stubGlobal('fetch', fetchMock)
    const route = makeBalanceRoute(makeCtx(deepseekServices()))
    const { res, status, body } = makeRes()
    await route.handler(makeReq(), res)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/user/balance')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test-123')
    expect(status()).toBe(200)
    expect(body()).toMatchObject({
      ok: true,
      provider: 'deepseek-official',
      supported: true,
      available: true,
      currency: 'CNY',
      totalBalance: '5.79',
      grantedBalance: '0.00',
      toppedUpBalance: '5.79',
    })
  })

  it('falls back to the first registered provider when no default selection exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeBalanceResponse())
    vi.stubGlobal('fetch', fetchMock)
    const services = deepseekServices()
    services.agentDefaultModel = undefined
    const route = makeBalanceRoute(makeCtx(services))
    const { res, body } = makeRes()
    await route.handler(makeReq(), res)
    expect(body()).toMatchObject({ provider: 'deepseek-official', supported: true })
  })

  it('reports unsupported when no provider is configured', async () => {
    const route = makeBalanceRoute(makeCtx({}))
    const { res, status, body } = makeRes()
    await route.handler(makeReq(), res)
    expect(status()).toBe(200)
    expect(body()).toMatchObject({ ok: true, provider: '', supported: false, error: 'no provider configured' })
  })

  it('reports unsupported when the credential reference is unconfigured', async () => {
    const services = deepseekServices()
    services.credentials = { resolve: async () => undefined }
    const route = makeBalanceRoute(makeCtx(services))
    const { res, body } = makeRes()
    await route.handler(makeReq(), res)
    expect(body()).toMatchObject({
      provider: 'deepseek-official',
      supported: false,
      error: expect.stringContaining('no credential configured'),
    })
  })

  it('reports unsupported for a provider without a balance endpoint', async () => {
    const services = {
      agentDefaultModel: { currentSelection: () => ({ provider: 'other-provider' }) },
      llm: { listProviders: () => [{ id: 'other-provider' }] },
      credentials: { resolve: async () => ({ value: 'sk-other', source: 'env' }) },
    }
    const route = makeBalanceRoute(makeCtx(services))
    const { res, body } = makeRes()
    await route.handler(makeReq(), res)
    expect(body()).toMatchObject({
      provider: 'other-provider',
      supported: false,
      error: expect.stringContaining('balance is not supported'),
    })
  })

  it('returns 500 with ok:false when the balance API call throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const route = makeBalanceRoute(makeCtx(deepseekServices()))
    const { res, status, body } = makeRes()
    await route.handler(makeReq(), res)
    expect(status()).toBe(500)
    expect(body()).toMatchObject({ ok: false, supported: false, error: 'network down' })
  })

  it('rejects non-loopback requests with 403', async () => {
    const req = {
      method: 'GET',
      url: '/api/dsh-token-cost/balance',
      socket: { remoteAddress: '203.0.113.5' },
      headers: { host: 'localhost:1234' },
    } as unknown as IncomingMessage
    const route = makeBalanceRoute(makeCtx({}))
    const { res, status, body } = makeRes()
    await route.handler(req, res)
    expect(status()).toBe(403)
    expect(body()).toMatchObject({ error: 'forbidden: loopback-only' })
  })
})
