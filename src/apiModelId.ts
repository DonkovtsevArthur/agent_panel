/**
 * Wire model id for the gateway, without vscode imports so unit tests can
 * load it directly.
 *
 * Picker ids for non-default providers carry the provider prefix
 * (`гена/deepseek-v4.1-flash`). Rows saved by WebStorm may lack `apiModelId`,
 * so the prefix is stripped here when the row's own provider id matches.
 */
export function apiModelIdFromPicker(
  pickerId: string,
  row: { apiModelId?: string; providerId?: string } | undefined
): string {
  const id = String(pickerId || "").trim();
  if (!id) {
    return id;
  }
  const explicit = String(row?.apiModelId || "").trim();
  if (explicit) {
    return explicit;
  }
  const providerId = String(row?.providerId || "").trim();
  const prefix = providerId ? `${providerId}/` : "";
  if (prefix && id.startsWith(prefix) && id.length > prefix.length) {
    return id.slice(prefix.length);
  }
  return id;
}
