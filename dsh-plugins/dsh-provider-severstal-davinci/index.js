/**
 * Severstal DaVinci corporate provider bundle for DeepSeek Harness.
 *
 * On load this module does three host-side things:
 *
 *   1. `trustCorporateCa` — merge the corporate CA chain (certs/severstal-ca.pem)
 *      into the process-wide default trust store. The DaVinci gateway is signed
 *      by "SeverstalGroupRoot", which Node's bundled CA store does not include,
 *      so without this every request fails TLS verification and surfaces as
 *      `code: "TRANSPORT"`.
 *
 *   2. `materializeRoute` — declare the `severstal-davinci` route (catalog
 *      below) in the profile's own `llm-pi-ai` entry through the ConfigEditor
 *      service (the same write path Settings -> Models uses). The route must
 *      live in the `llm-pi-ai` namespace: the Models page renders its API-key
 *      input only for providers in that namespace (`layoutOf` in the client).
 *      The write is a minimal merge — existing providers (e.g. `mimo`) are
 *      preserved — and it is skipped once the route is present, so UI edits to
 *      the route stick.
 *
 *   3. `seedApiKey` — optional: when the bundle ships a `secrets/api-key` file,
 *      seed its contents into the credential store (`SEVERSTAL_DAVINCI_API_KEY`)
 *      so an install can be fully scripted. With no file, the key is entered in
 *      Settings -> Models as usual.
 *
 * No LLM adapter is mounted here: the profile's own `llm-pi-ai` adapter serves
 * the route once it is materialized, so there is no duplicate-directory /
 * duplicate-flow hazard and no extra npm dependency.
 */
import fs from 'node:fs'
import tls from 'node:tls'

export const name = 'dsh-provider-severstal-davinci'

/** Credential reference the route resolves its API key through. */
const API_KEY_REF = 'SEVERSTAL_DAVINCI_API_KEY'

/** Provider route id (also the Settings -> Models row and the key-ref base). */
const ROUTE_ID = 'severstal-davinci'

/** The route profile materialized into the profile's `llm-pi-ai` entry. */
const ROUTE = {
	apiKeyEnv: API_KEY_REF,
	displayName: 'Severstal DaVinci',
	api: 'openai-completions',
	baseURL: 'https://ai-platform.kube.severstal.severstalgroup.com/openai',
	models: [
		// flagship; multimodal (text+image), tool calling, thinking stream — verified
		{ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1048576, maxTokens: 65536, input: ['text', 'image'] },
		{ id: 'z-ai/glm-5.3', name: 'GLM-5.3', contextWindow: 1048576, maxTokens: 65536 },
		{ id: 'z-ai/glm-5.3-flash', name: 'GLM-5.3 Flash', contextWindow: 1048576, maxTokens: 65536 },
		{ id: 'openai/gpt-5.6-terra', name: 'GPT-5.6 Terra', contextWindow: 1050000, maxTokens: 64000 },
		{ id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', contextWindow: 922000, maxTokens: 64000 },
		{ id: 'openai/gpt-6-sol', name: 'GPT-6 Sol', contextWindow: 922000, maxTokens: 64000 },
		{ id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', contextWindow: 1050000, maxTokens: 64000 },
		{ id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', contextWindow: 1000000, maxTokens: 64000 },
		{ id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5', contextWindow: 200000, maxTokens: 64000 },
		{ id: 'anthropic/claude-fable-5.1', name: 'Claude Fable 5.1', contextWindow: 200000, maxTokens: 64000 },
		{ id: 'moonshotai/kimi-k3', name: 'Kimi K3', contextWindow: 1048576, maxTokens: 65536 },
		{ id: 'qwen3.8-27b', name: 'Qwen3.8 27B', contextWindow: 262144, maxTokens: 65536 },
		{ id: 'T-lite-it', name: 'T-Lite IT', contextWindow: 40960, maxTokens: 40960 },
		{ id: 'Gemini Deep Research', name: 'Gemini Deep Research', contextWindow: 1048576, maxTokens: 65535 },
	],
}

/**
 * Trust the corporate CA chain that signs the DaVinci gateway
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
		console.warn('[dsh-provider-severstal-davinci] tls.setDefaultCACertificates is unavailable; requests to the DaVinci gateway may fail TLS verification')
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

/**
 * Seed the route's credential from the bundle's own key file (optional).
 * With a `secrets/api-key` file present the file owns the key (re-seeded at
 * every load, so editing it rotates the key); with no file the credential store
 * / Settings -> Models stay in charge as usual.
 */
function seedApiKey(ctx) {
	let raw
	try {
		raw = fs.readFileSync(new URL('./secrets/api-key', import.meta.url), 'utf8')
	} catch {
		return // no key file — credential store / Settings -> Models remain in charge
	}
	const key = raw.trim()
	if (key.length === 0) return
	const run = async (scope) => {
		const credentials = scope.get('credentials')
		if (credentials === undefined) throw new Error('credentials service unavailable')
		const current = await credentials.resolve(API_KEY_REF)
		if (current?.value === key) return
		await credentials.set(API_KEY_REF, key)
	}
	const warn = (error) => console.warn(`[dsh-provider-severstal-davinci] could not seed ${API_KEY_REF} from secrets/api-key:`, error?.message ?? error)
	try {
		ctx.inject(['credentials'], (scope) => {
			run(scope).catch(warn)
		})
	} catch {
		run(ctx).catch(warn)
	}
}

/**
 * Declare the route in the profile's `llm-pi-ai` entry through the
 * ConfigEditor service — the same persistent write path Settings -> Models
 * uses, so the row lands in the user-owned layer and the Models page renders
 * its full editor, including the API-key input. Retries while boot brings the
 * `llm-pi-ai` entry up; idempotent once the route is present.
 */
function materializeRoute(ctx) {
	const log = (message) => {
		try {
			fs.appendFileSync(new URL('./debug.log', import.meta.url), `${new Date().toISOString()} ${message}\n`)
		} catch {}
	}
	const warn = (error) => {
		log(`WARN could not add the route to llm-pi-ai: ${error?.stack ?? error?.message ?? error}`)
		console.warn('[dsh-provider-severstal-davinci] could not add the route to llm-pi-ai:', error?.message ?? error)
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
			if (current.providers?.[ROUTE_ID] !== undefined) {
				log('route already present')
				return
			}
			const run = () => {
				void configEditor.edit(entry, (live) => {
					const providers = { ...(live.providers ?? {}) }
					if (providers[ROUTE_ID] !== undefined) return live
					return { ...live, providers: { ...providers, [ROUTE_ID]: structuredClone(ROUTE) } }
				}).then(() => {
					log(`route "${ROUTE_ID}" added to the profile's llm-pi-ai entry`)
					console.warn(`[dsh-provider-severstal-davinci] route "${ROUTE_ID}" added to the profile's llm-pi-ai entry`)
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
	seedApiKey(ctx)
	materializeRoute(ctx)
}
