/**
 * Harbor HTTPS uses agentPanel.rejectUnauthorized (default true — strict
 * verify). NODE_EXTRA_CA_CERTS is left to the host / user env for custom CAs.
 */
export function applyFigmaTlsCaFromSettings(): void {
  /* no-op: CA path setting removed; TLS verify follows the global setting */
}
