/**
 * Gennadiy corporate provider bundle for DeepSeek Harness.
 *
 * On load this module does three host-side things:
 *
 *   1. `trustCorporateCa` — merge the corporate CA chain (certs/severstal-ca.pem)
 *      into the process-wide default trust store. The Gennadiy gateway is signed
 *      by "SeverstalGroupRoot", which Node's bundled CA store does not include,
 *      so without this every request fails TLS verification and surfaces as
 *      `code: "TRANSPORT"`.
 *
 *   2. `materializeRoute` — declare the `gennadiy` route (catalog below) in the
 *      profile's own `llm-pi-ai` entry through the ConfigEditor service (the
 *      same write path Settings -> Models uses). The route must live in the
 *      `llm-pi-ai` namespace: the Models page renders its API-key input only
 *      for providers in that namespace (`layoutOf` in the client). The write is
 *      a minimal merge — existing providers (e.g. `mimo`) are preserved — and
 *      once the route is present only its model limits are touched again:
 *      values above SAFE_LIMITS break against the gateway's 1 MiB body ceiling
 *      (413 / truncated answers), so they are clamped back on every load while
 *      every other UI edit sticks.
 *
 *   3. `keepCredentialFresh` — the part that differs from a static-key provider:
 *      the route sends one static key (`apiKeyEnv`) with every request, but the
 *      Keycloak access token behind it lives only ~30 minutes. The keeper reads
 *      the `gennadiy` CLI auth store (~/.local/share/gennadiy/auth.json,
 *      XDG_DATA_HOME aware) on load and on a timer (~5 minutes before the token
 *      expires) and keeps `GENNADIY_API_KEY` in the credential store in sync:
 *
 *        live CLI token -> refresh_token grant -> secrets/api-key fallback.
 *
 *      The refresh grant also writes the rotated tokens back into the CLI store
 *      (Keycloak rotates the refresh token), so the CLI and the harness keep
 *      sharing one session. When the store is missing or the grant is rejected
 *      the log says to run `gennadiy auth login`.
 *
 * No LLM adapter is mounted here: the profile's own `llm-pi-ai` adapter serves
 * the route once it is materialized, so there is no duplicate-directory /
 * duplicate-flow hazard and no extra npm dependency.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'

export const name = 'dsh-provider-gennadiy'

/** Credential reference the route resolves its API key through. */
const API_KEY_REF = 'GENNADIY_API_KEY'

/** Provider route id (also the Settings -> Models row and the key-ref base). */
const ROUTE_ID = 'gennadiy'

/** Keycloak SSO behind `gennadiy auth login` (gennadiy 1.18.3 PRESETS.test.keycloak). */
const KEYCLOAK = {
	url: 'https://sso-id-test-int.severstal.com',
	realm: 'common',
	/**
	 * Fallback client, used only when the presented refresh token carries no
	 * `azp` claim and no override is configured.
	 *
	 * Keycloak binds a refresh token to the client that received it and rejects
	 * a cross-client refresh with `invalid_grant: Invalid refresh token. Token
	 * client and authorized client don't match`. The CLI has two clients —
	 * `gennadiy-df` (device flow) and `gennadiy-sf` (browser authorization
	 * code) — so a hardcoded id silently breaks every session that logged in
	 * through the other one. `keycloakClientFor()` therefore reads the client
	 * from the token itself.
	 */
	clientId: 'gennadiy-df',
}

/** Access tokens live ~30 min — rotate ~5 minutes before expiry. */
const REFRESH_LEAD_MS = 5 * 60 * 1000
/** Re-read the CLI store on this cadence too: the CLI / Harbor share it. */
const MAX_CHECK_GAP_MS = 5 * 60 * 1000
/** Never hammer a dead token endpoint / missing auth store. */
const MIN_CHECK_DELAY_MS = 30 * 1000
/** A hung token endpoint must not block every later run. */
const REFRESH_TIMEOUT_MS = 15_000

/**
 * Transport-safe caps for the route's model limits.
 *
 * The gateway's ingress (nginx) rejects request bodies over 1 MiB — measured
 * exactly: 1 048 576 bytes pass, 1 048 650 return 413 "Request Entity Too
 * Large". A conversation of ~250k tokens already exceeds that byte ceiling, so
 * a 1M-token `contextWindow` lets the session grow straight into the 413 wall.
 * It also breaks the output budget: the client sizes each answer as
 * `contextWindow - used`, so when the window drops below the accumulated
 * history every response is cut to ~1 token ("Достигнут предел выходных
 * токенов").
 *
 *   contextWindow 120 000  — ~500 KB of body worst case, so auto-compact runs
 *                            long before the 1 MiB ceiling;
 *   maxTokens 65 536       — a sane answer budget that still fits the window.
 */
const SAFE_LIMITS = {
	contextWindow: 120000,
	maxTokens: 65536,
}

/**
 * Model catalog — verified against `GET {baseURL}/models` on 2026-11-06 (VPN):
 * the gateway serves these three models (a subset of the ai-platform catalog)
 * and declares per-model `max_input_tokens` / `max_output_tokens` of
 * deepseek-v4.1-flash 1 048 576/1 048 576, glm-5.3 524 288/524 288 and
 * qwen3.8-27b 262 144/262 144. Those declared values exceed what the
 * transport can carry (see SAFE_LIMITS), so the catalog ships the capped ones.
 *
 * Plain data on purpose: edit the array — or the route in Settings -> Models —
 * after a gateway upgrade; nothing else in this file depends on the list.
 */
const MODELS = [
	// flagship; multimodal (text+image), tool calling, thinking stream — verified live
	{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: SAFE_LIMITS.contextWindow, maxTokens: SAFE_LIMITS.maxTokens, input: ['text', 'image'] },
	{ id: 'glm-5.3', name: 'GLM-5.3', contextWindow: SAFE_LIMITS.contextWindow, maxTokens: SAFE_LIMITS.maxTokens },
	{ id: 'qwen3.8-27b', name: 'Qwen3.8 27B', contextWindow: SAFE_LIMITS.contextWindow, maxTokens: SAFE_LIMITS.maxTokens },
]

/** True when any model on the route exceeds the transport-safe caps. */
function needsLimitFix(route) {
	return (route.models ?? []).some((model) =>
		numberOr0(model.contextWindow) > SAFE_LIMITS.contextWindow ||
		numberOr0(model.maxTokens) > SAFE_LIMITS.maxTokens
	)
}

/** Clamp the route's model limits to SAFE_LIMITS (a new object when changed). */
function fixLimits(route) {
	if (!needsLimitFix(route)) return route
	return {
		...route,
		models: (route.models ?? []).map((model) => ({
			...model,
			contextWindow: Math.min(numberOr0(model.contextWindow) || SAFE_LIMITS.contextWindow, SAFE_LIMITS.contextWindow),
			maxTokens: Math.min(numberOr0(model.maxTokens) || SAFE_LIMITS.maxTokens, SAFE_LIMITS.maxTokens),
		})),
	}
}

/** The route profile materialized into the profile's `llm-pi-ai` entry. */
const ROUTE = {
	apiKeyEnv: API_KEY_REF,
	displayName: 'Gennadiy',
	api: 'openai-completions',
	baseURL: 'https://gennadiy-test.kube.severstal.severstalgroup.com/gennadiy/v1',
	models: MODELS,
}

/** Append to debug.log next to the bundle (gitignored) — one shared trail. */
const log = (message) => {
	try {
		fs.appendFileSync(new URL('./debug.log', import.meta.url), `${new Date().toISOString()} ${message}\n`)
	} catch {}
}

const numberOr0 = (value) => (Number(value) > 0 ? Number(value) : 0)

/**
 * A disabled / reloaded bundle leaves its keeper timer alive in the host
 * process; this generation counter lets the newest `keepCredentialFresh`
 * instance supersede the older ones, so only one refresh chain stays running.
 */
let keeperGeneration = 0

/**
 * Trust the corporate CA chain that signs the Gennadiy gateway
 * (`*.kube.severstal.severstalgroup.com` <- "Severstal Internal CA" <-
 * self-signed "SeverstalGroupRoot"). The root is in the macOS keychain but not
 * in Node's bundled CA store, so host-side fetch fails with
 * SELF_SIGNED_CERT_IN_CHAIN and requests surface as `code: "TRANSPORT"`.
 * Merge the corp CA into the process-wide default trust store at load time;
 * public CAs (and the system store, when the runtime exposes it) are kept.
 */
function trustCorporateCa() {
	const pem = fs.readFileSync(new URL('./certs/severstal-ca.pem', import.meta.url), 'utf8')
	if (typeof tls.setDefaultCACertificates !== 'function') {
		console.warn('[dsh-provider-gennadiy] tls.setDefaultCACertificates is unavailable; requests to the Gennadiy gateway may fail TLS verification')
		return
	}
	const current = []
	for (const store of ['system', 'default']) {
		try {
			if (typeof tls.getCACertificates === 'function') {
				for (const cert of tls.getCACertificates(store)) {
					current.push(typeof cert === 'string' ? cert : Buffer.from(cert).toString())
				}
			}
		} catch {
			// CA store not exposed by this runtime; skip it.
		}
	}
	tls.setDefaultCACertificates([...current, pem])
}

/** CLI auth store path (XDG data dir, same layout as the `gennadiy` CLI). */
function authJsonPath() {
	const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
	return path.join(dataHome, 'gennadiy', 'auth.json')
}

/** The `keycloak` entry of the CLI auth store, or undefined when absent. */
function readCliStore() {
	try {
		const parsed = JSON.parse(fs.readFileSync(authJsonPath(), 'utf8'))
		return parsed && typeof parsed === 'object' ? parsed : undefined
	} catch {
		return undefined
	}
}

/** Access token still usable for `skewMs` more ("" when missing / too old). */
function liveAccessToken(entry, skewMs) {
	const access = String(entry?.access || '').trim()
	if (!access) return ''
	const expires = Number(entry?.expires)
	// No expiry recorded — trust the token (the CLI always stamps one).
	if (!Number.isFinite(expires) || expires <= 0) return access
	return expires > Date.now() + skewMs ? access : ''
}

/** Static fallback key shipped with the bundle (optional, like the davinci one). */
function readSecretsApiKey() {
	try {
		return fs.readFileSync(new URL('./secrets/api-key', import.meta.url), 'utf8').trim()
	} catch {
		return ''
	}
}

/** Patch only the keycloak entry of the CLI auth store (merge, mode 0600). */
function writeKeycloakEntry(patch) {
	const file = authJsonPath()
	fs.mkdirSync(path.dirname(file), { recursive: true })
	let store = {}
	try {
		store = JSON.parse(fs.readFileSync(file, 'utf8'))
	} catch {
		store = {}
	}
	const prev = store.keycloak || {}
	store.keycloak = {
		...prev,
		type: 'oauth',
		access: patch.access ?? prev.access,
		refresh: patch.refresh ?? prev.refresh,
		expires: patch.expires ?? prev.expires,
		email: patch.email ?? prev.email,
		accountId: patch.accountId ?? prev.accountId,
	}
	fs.writeFileSync(file, JSON.stringify(store, null, 2), { mode: 0o600 })
}

function decodeJwtPayload(jwt) {
	try {
		const part = jwt.split('.')[1] || ''
		const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
		return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
	} catch {
		return {}
	}
}

/**
 * Confidential-client secrets for the refresh grant, keyed by Keycloak client
 * id: `{ "gennadiy-sf": "…", "gennadiy-df": "…" }`.
 *
 * Kept in `secrets/keycloak-clients.json` (gitignored, mode 0600) rather than in
 * this file so the client secrets never reach the repository. Missing file is
 * not an error — it only means public-client refreshes are attempted without a
 * secret, which is exactly what the previous behaviour did.
 */
function readKeycloakClientSecrets() {
	try {
		const parsed = JSON.parse(fs.readFileSync(new URL('./secrets/keycloak-clients.json', import.meta.url), 'utf8'))
		return parsed && typeof parsed === 'object' ? parsed : {}
	} catch {
		return {}
	}
}

/**
 * Client credentials that may refresh `refreshToken`.
 *
 * The `azp` claim is authoritative: it names the client the token was issued
 * to, and Keycloak refuses to refresh it from any other one. Env overrides win
 * (`GENNADIY_KEYCLOAK_CLIENT_ID` / `GENNADIY_KEYCLOAK_CLIENT_SECRET`) so a
 * rotated secret can be applied without editing the bundle.
 */
function keycloakClientFor(refreshToken) {
	const azp = String(decodeJwtPayload(refreshToken).azp || '').trim()
	const envClientId = String(process.env.GENNADIY_KEYCLOAK_CLIENT_ID || '').trim()
	const envSecret = String(process.env.GENNADIY_KEYCLOAK_CLIENT_SECRET || '').trim()
	const clientId = azp || envClientId || KEYCLOAK.clientId
	const fromFile = readKeycloakClientSecrets()[clientId]
	const fileSecret = typeof fromFile === 'string' ? fromFile : String(fromFile?.client_secret || '')
	return { clientId, clientSecret: envSecret || fileSecret.trim() }
}

/**
 * refresh_token grant against the realm token endpoint (the same call
 * src/gennadiyTokenRefresh.ts -> src/keycloakDeviceAuth.ts makes). Throws when
 * the grant is rejected or the endpoint is unreachable; on success returns the
 * token set — the response may carry a rotated refresh token.
 */
async function refreshViaKeycloak(refreshToken) {
	const base = `${KEYCLOAK.url.replace(/\/$/, '')}/realms/${KEYCLOAK.realm}/protocol/openid-connect`
	const client = keycloakClientFor(refreshToken)
	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
		client_id: client.clientId,
		scope: 'offline_access',
	})
	if (client.clientSecret) body.set('client_secret', client.clientSecret)
	const res = await fetch(`${base}/token`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Accept: 'application/json',
		},
		body: body.toString(),
		signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
	})
	const json = await res.json().catch(() => ({}))
	if (!res.ok || !json.access_token) {
		throw new Error(
			`refresh_token grant rejected (client ${client.clientId}): ${res.status} ${String(json.error || '')} ${String(json.error_description || '')}`.trim()
		)
	}
	const claims = decodeJwtPayload(String(json.id_token || json.access_token))
	return {
		access: String(json.access_token),
		refresh: String(json.refresh_token || refreshToken),
		expires: Date.now() + (Number(json.expires_in) || 300) * 1000,
		email: String(claims.email || claims.preferred_username || ''),
		accountId: String(claims.sub || ''),
	}
}

/**
 * Keep `GENNADIY_API_KEY` in the credential store synced with the Keycloak
 * session the `gennadiy` CLI stores in ~/.local/share/gennadiy/auth.json. The
 * route sends one static key per request, so the bundle itself keeps that key
 * fresh:
 *
 *   - on load and on a timer (about 5 minutes before the access token expires,
 *     plus a periodic re-read so updates another process wrote into the shared
 *     CLI store are picked up) read the CLI store — whatever process
 *     (CLI / Harbor) rotated the token last simply wins;
 *   - when the token is missing or about to expire, refresh it through the
 *     refresh_token grant and write the fresh value — and the rotated refresh
 *     token — back into the CLI store and the credential store;
 *   - no store / rejected grant -> log «выполните gennadiy auth login» and fall
 *     back to `secrets/api-key` when present.
 *
 * Priority of key sources: live CLI token -> refresh -> secrets/api-key.
 */
function keepCredentialFresh(ctx) {
	const generation = ++keeperGeneration
	let scope // credentials scope, captured once the service is up
	let timer
	let refreshInFlight
	let lastState = ''

	const credentials = () => {
		try {
			return scope?.get('credentials') ?? ctx.get('credentials')
		} catch {
			return undefined
		}
	}

	const setCredential = async (key) => {
		const service = credentials()
		if (service === undefined) throw new Error('credentials service unavailable')
		const current = await service.resolve(API_KEY_REF)
		if (current?.value === key) return false
		await service.set(API_KEY_REF, key)
		return true
	}

	// Concurrent ticks share one network refresh (single-flight).
	const refreshOnce = (refreshToken) => {
		if (refreshInFlight === undefined) {
			refreshInFlight = refreshViaKeycloak(refreshToken).finally(() => {
				refreshInFlight = undefined
			})
		}
		return refreshInFlight
	}

	const resolveKey = async () => {
		const entry = readCliStore()?.keycloak
		// 1. a comfortably live token from the CLI store
		const live = liveAccessToken(entry, REFRESH_LEAD_MS)
		if (live) return { key: live, expiresAt: numberOr0(entry?.expires), source: 'cli', needLogin: false }
		// 2. refresh_token grant while a refresh token is around
		const refresh = String(entry?.refresh || '').trim()
		if (refresh) {
			try {
				const tokens = await refreshOnce(refresh)
				// Keycloak rotates the refresh token — keep the CLI in the loop.
				try {
					writeKeycloakEntry(tokens)
				} catch (error) {
					log(`WARN could not update the CLI auth store: ${error?.message ?? error}`)
				}
				return { key: tokens.access, expiresAt: tokens.expires, source: 'refresh', needLogin: false }
			} catch (error) {
				log(`WARN token refresh failed: ${error?.message ?? error}`)
				// The CLI / another IDE may have rotated the tokens meanwhile.
				const stored = readCliStore()?.keycloak
				const stillLive = liveAccessToken(stored, 60_000)
				if (stillLive) return { key: stillLive, expiresAt: numberOr0(stored?.expires), source: 'cli', needLogin: false }
			}
		}
		// 3. optional static fallback shipped with the bundle
		const fallback = readSecretsApiKey()
		if (fallback) return { key: fallback, expiresAt: 0, source: 'secrets', needLogin: true }
		return { key: '', expiresAt: 0, source: 'none', needLogin: true }
	}

	const sync = async (why) => {
		const { key, expiresAt, source, needLogin } = await resolveKey()
		const state = key ? `ok:${source}` : 'missing'
		if (needLogin && (why === 'load' || state !== lastState)) {
			const hint = `нет живого токена Keycloak (CLI-стор: ${authJsonPath()}) — выполните \`gennadiy auth login\``
			const tail = key
				? `; используется фолбэк ${source}`
				: '; ключ не задан — запросы будут падать с MISSING_CREDENTIAL (или положите ключ в secrets/api-key)'
			log(`WARN ${hint}${tail}`)
			console.warn(`[dsh-provider-gennadiy] ${hint}`)
		}
		if (key) {
			let updated
			try {
				updated = await setCredential(key)
			} catch (error) {
				log(`WARN could not sync ${API_KEY_REF} (${why}): ${error?.message ?? error}`)
				console.warn(`[dsh-provider-gennadiy] could not sync ${API_KEY_REF}:`, error?.message ?? error)
				lastState = ''
				return { expiresAt: 0, fastRetry: true }
			}
			if (why === 'load' || source === 'refresh' || updated || state !== lastState) {
				log(`${why}: ${API_KEY_REF} <- ${source}${updated ? ' (value updated)' : ''}`)
			}
		}
		lastState = state
		return { expiresAt, fastRetry: false }
	}

	const schedule = (delay) => {
		if (timer !== undefined) clearTimeout(timer)
		if (generation !== keeperGeneration) return // superseded by a newer instance
		timer = setTimeout(kick, delay)
		timer.unref?.() // never hold the process open
	}

	const kick = (why = 'timer') => {
		if (generation !== keeperGeneration) return
		sync(why)
			.then(({ expiresAt, fastRetry }) => {
				let delay = fastRetry ? MIN_CHECK_DELAY_MS : MAX_CHECK_GAP_MS
				if (!fastRetry && expiresAt > 0) {
					delay = Math.min(delay, Math.max(MIN_CHECK_DELAY_MS, expiresAt - Date.now() - REFRESH_LEAD_MS))
				}
				schedule(delay)
			})
			.catch((error) => {
				log(`WARN ${why} sync crashed: ${error?.stack ?? error?.message ?? error}`)
				schedule(MIN_CHECK_DELAY_MS)
			})
	}

	// Capture the credentials scope as soon as the service is up, then run the
	// first sync; if the service never appears through inject the chain still
	// runs (ctx.get fallback) and simply retries on the timer.
	let started = false
	const start = () => {
		if (started) return
		started = true
		kick('load')
	}
	try {
		ctx.inject(['credentials'], (injected) => {
			scope = injected
			start()
		})
	} catch {
		start()
	}
	schedule(MIN_CHECK_DELAY_MS)
}

/**
 * Declare the route in the profile's `llm-pi-ai` entry through the
 * ConfigEditor service — the same persistent write path Settings -> Models
 * uses, so the row lands in the user-owned layer and the Models page renders
 * its full editor, including the API-key input. Retries while boot brings the
 * `llm-pi-ai` entry up; idempotent once the route is present.
 *
 * An already-present route is left alone — except when its model limits exceed
 * SAFE_LIMITS: those values reliably break against the gateway's 1 MiB body
 * ceiling (413 / truncated answers), so they are clamped back on every load.
 * Any other UI edit (names, baseURL, added models) sticks.
 */
function materializeRoute(ctx) {
	const warn = (error) => {
		log(`WARN could not add the route to llm-pi-ai: ${error?.stack ?? error?.message ?? error}`)
		console.warn('[dsh-provider-gennadiy] could not add the route to llm-pi-ai:', error?.message ?? error)
	}
	const attempt = (left) => {
		const settle = (why) => {
			log(`retry(${left}) ${why}`)
			if (left > 1) setTimeout(() => attempt(left - 1), 1000)
			else warn(new Error(`llm-pi-ai entry did not become available: ${why}`))
		}
		let configEditor
		try {
			configEditor = ctx.get('configEditor')
			if (configEditor === undefined) return settle('configEditor service undefined')
			const entry = configEditor.entries().find((candidate) => candidate.options.id === 'llm-pi-ai' && candidate.options.name === '@deepseek-ai/dsh-llm-pi-ai')
			if (entry === undefined) return settle(`llm-pi-ai entry not found among ${configEditor.entries().length} entries`)
			const current = entry.options.config ?? {}
			const existing = current.providers?.[ROUTE_ID]
			if (existing !== undefined && !needsLimitFix(existing)) {
				log('route already present')
				return
			}
			if (existing !== undefined) {
				log('route present, but its limits exceed the transport-safe caps — normalizing')
			}
			const run = () => {
				void configEditor.edit(entry, (live) => {
					const providers = { ...(live.providers ?? {}) }
					const route = providers[ROUTE_ID]
					if (route === undefined) return { ...live, providers: { ...providers, [ROUTE_ID]: structuredClone(ROUTE) } }
					const fixed = fixLimits(route)
					if (fixed === route) return live
					return { ...live, providers: { ...providers, [ROUTE_ID]: fixed } }
				}).then(() => {
					const what = existing === undefined
						? `route "${ROUTE_ID}" added to the profile's llm-pi-ai entry`
						: `route "${ROUTE_ID}" limits normalized to the transport-safe caps (contextWindow ${SAFE_LIMITS.contextWindow}, maxTokens ${SAFE_LIMITS.maxTokens})`
					log(what)
					console.warn(`[dsh-provider-gennadiy] ${what}`)
				}).catch((error) => {
					if (left > 1) {
						log(`edit rejected (${left}): ${error?.message ?? error}`)
						setTimeout(() => attempt(left - 1), 1000)
					} else warn(error)
				})
			}
			// The enable transaction runs inside HMR's AsyncLocalStorage, and
			// `configEditor.edit` opens its own `runExclusive` transaction —
			// "HMR transactions cannot be nested". `exit` drops the store so the
			// edit is queued as a normal transaction instead of being rejected.
			const hmr = ctx.get('hmr')
			if (hmr !== undefined && typeof hmr.executing?.exit === 'function') hmr.executing.exit(run)
			else run()
		} catch (error) {
			if (left > 1) {
				log(`sync error (${left}): ${error?.message ?? error}`)
				setTimeout(() => attempt(left - 1), 1000)
			} else warn(error)
		}
	}
	attempt(60)
}

export function apply(ctx) {
	trustCorporateCa()
	materializeRoute(ctx)
	keepCredentialFresh(ctx)
}

/**
 * Internals exposed for out-of-band diagnostics (refresh-grant smoke tests,
 * client selection checks). Nothing in the harness calls these.
 */
export const __testing = { keycloakClientFor, refreshViaKeycloak }
