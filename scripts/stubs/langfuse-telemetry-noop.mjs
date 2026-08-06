/**
 * Harbor stub: Cline Langfuse helpers always report disabled.
 * Used via esbuild alias / onResolve so vendor source stays untouched.
 */

export function hasLangfuseTelemetryConfig() {
  return false;
}

export async function ensureLangfuseTelemetry(_providerId) {
  return false;
}

export async function disposeLangfuseTelemetry() {}

export function debugLangfuse(_message) {}

export function resetLangfuseTelemetryForTests() {}
