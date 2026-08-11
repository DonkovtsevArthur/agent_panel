/**
 * Harbor HTTPS uses agentPanel.rejectUnauthorized (default false) so a CA
 * bundle is not required. NODE_EXTRA_CA_CERTS is left to the host / user env.
 */
export function applyFigmaTlsCaFromSettings(): void {
  /* no-op: CA path setting removed; TLS verify off by default */
}
