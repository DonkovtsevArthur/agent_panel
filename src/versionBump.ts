/**
 * Follow-up после уточнения версии в package.json («19» / «да» / «0.0.19»).
 * Без vscode — тестируется отдельно.
 */

function hasAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

const SEMVER_RE = /\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/g;

/** Строгая semver для валидации значения поля version (без surrounding-текста). */
const SEMVER_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export type VersionClarification = {
  current?: string;
  suggested?: string;
};

export function looksLikeVersionClarification(text: string): boolean {
  const value = String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е");
  if (!value) {
    return false;
  }
  const asks = hasAny(value, [
    "на какую версию",
    "какую версию",
    "уточни",
    "which version",
    "what version",
    "поднять patch",
    "поднять до",
    "bump to",
    "bump the patch",
  ]);
  const aboutVersion =
    hasAny(value, ["верси", "version", "package.json"]) &&
    /\d+\.\d+\.\d+/.test(value);
  return asks && aboutVersion;
}

export function parseVersionClarification(text: string): VersionClarification {
  const raw = String(text || "");
  const versions = [...raw.matchAll(SEMVER_RE)].map((m) => m[1]);
  SEMVER_RE.lastIndex = 0;
  if (!versions.length) {
    return {};
  }
  const lower = raw.toLowerCase().replace(/ё/g, "е");
  let current = versions[0];
  let suggested = versions.length > 1 ? versions[1] : undefined;

  const currentMatch = lower.match(
    /(?:стоит|сейчас|current(?:ly)?(?:\s+is)?|is)\s+[^\d]{0,40}?(\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?)/i
  );
  if (currentMatch?.[1]) {
    current = currentMatch[1];
  }
  const suggestedMatch = lower.match(
    /(?:до|to|→|->)\s*[^\d]{0,12}?(\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?)/i
  );
  if (suggestedMatch?.[1]) {
    suggested = suggestedMatch[1];
  }
  if (!suggested && current) {
    suggested = bumpPatchVersion(current) || undefined;
  }
  return { current, suggested };
}

export function bumpPatchVersion(version: string): string | null {
  const m = String(version || "").match(
    /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/
  );
  if (!m) {
    return null;
  }
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}${m[4] || ""}`;
}

/** Короткий ответ на уточнение версии: «19», «да», «0.0.19». */
export function looksLikeVersionFollowUpReply(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw || raw.length > 48) {
    return false;
  }
  if (/^(да|yes|ok|ок|ага|угу|lf|y)\.?$/i.test(raw)) {
    return true;
  }
  if (/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/i.test(raw)) {
    return true;
  }
  if (/^\d+\.\d+$/.test(raw)) {
    return true;
  }
  if (/^\d{1,6}$/.test(raw)) {
    return true;
  }
  return false;
}

export function resolveTargetVersion(
  userText: string,
  clarification: VersionClarification
): string | null {
  const raw = String(userText || "").trim();
  if (!raw) {
    return null;
  }
  if (/^(да|yes|ok|ок|ага|угу|lf|y)\.?$/i.test(raw)) {
    return (
      clarification.suggested ||
      (clarification.current
        ? bumpPatchVersion(clarification.current)
        : null) ||
      null
    );
  }
  const full = raw.match(/^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/i);
  if (full) {
    return full[1];
  }
  const minor = raw.match(/^(\d+\.\d+)$/);
  if (minor) {
    return `${minor[1]}.0`;
  }
  if (/^\d{1,6}$/.test(raw)) {
    const base = clarification.suggested || clarification.current;
    if (!base) {
      return null;
    }
    const parts = base.split(".");
    if (parts.length < 3) {
      return null;
    }
    parts[2] = raw.replace(/^v/i, "");
    // drop prerelease from base when replacing patch via bare number
    const patchPart = parts[2].split("-")[0];
    return `${parts[0]}.${parts[1]}.${patchPart}`;
  }
  return null;
}

export function lastAssistantText(
  history: Array<{ role?: string; content?: unknown }>
): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const msg = history[i];
    if (msg?.role !== "assistant") {
      continue;
    }
    const content = msg.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const text = content
        .map((p) =>
          p && typeof p === "object" && (p as { type?: string }).type === "text"
            ? String((p as { text?: string }).text || "")
            : ""
        )
        .join("\n")
        .trim();
      if (text) {
        return text;
      }
    }
  }
  return "";
}

/**
 * Если прошлый ответ агента уточнял версию, а пользователь ответил числом/«да» —
 * возвращаем целевую версию для детерминированного bump.
 */
export function resolveVersionBumpFollowUp(
  userText: string,
  history: Array<{ role?: string; content?: unknown }>
): { targetVersion: string; clarification: VersionClarification } | null {
  if (!looksLikeVersionFollowUpReply(userText)) {
    return null;
  }
  const assistant = lastAssistantText(history);
  if (!looksLikeVersionClarification(assistant)) {
    return null;
  }
  const clarification = parseVersionClarification(assistant);
  const targetVersion = resolveTargetVersion(userText, clarification);
  if (!targetVersion) {
    return null;
  }
  return { targetVersion, clarification };
}

/** «Поменяй / давай поменяем версию» — без обязательного числа в ответе. */
export function looksLikeVersionChangeRequest(text: string): boolean {
  const value = String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
  if (!value || value.length > 120) {
    return false;
  }
  if (/^(какая|какой|what|which|сколько)\b/.test(value)) {
    return false;
  }
  if (/(не\s+меня|не\s+надо|не\s+нужно|don't|do not)/.test(value)) {
    return false;
  }
  return (
    /(?:поменя|смени|обнов|подним|постав|увелич|bump|change|update|set).{0,48}верси/.test(
      value
    ) ||
    /верси.{0,48}(?:поменя|смени|обнов|подним|постав|увелич|bump|change|update)/.test(
      value
    ) ||
    /давай\s+(?:ее|её|еe|ее\s+)?поменя/.test(value) ||
    /давай\s+поменя/.test(value) ||
    /^(поменяй|смени|обнови|подними)\s*(ее|её|еe)?\.?$/.test(value) ||
    // «поменяй на 22» / «подними до 23» / «поставь на 22» — голый patch без слова «версия».
    /(?:поменя|смени|обнов|подним|постав|увелич).{0,30}(?:на|до)\s+\d{1,6}\s*\.?$/.test(
      value
    )
  );
}

/** Версия из ответа вроде «Версия приложения: **0.0.18**». */
export function extractReportedAppVersion(text: string): string | null {
  const raw = String(text || "");
  const bold = raw.match(
    /верси[^\d*]{0,40}\*\*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\*\*/i
  );
  if (bold?.[1]) {
    return bold[1];
  }
  const labeled = raw.match(
    /(?:version|верси[яи])[^\d]{0,40}(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i
  );
  if (labeled?.[1]) {
    return labeled[1];
  }
  const versions = [...raw.matchAll(SEMVER_RE)].map((m) => m[1]);
  SEMVER_RE.lastIndex = 0;
  return versions[0] || null;
}

/**
 * Локальный bump без LLM:
 * — follow-up «19»/«да» после уточнения;
 * — «давай поменяем» после ответа с текущей версией → patch+1;
 * — «поставь 0.0.19» / явная semver в запросе;
 * — иначе { readPackageAndBumpPatch: true } (версия с диска).
 */
export function resolveLocalVersionBump(
  userText: string,
  history: Array<{ role?: string; content?: unknown }>
):
  | { targetVersion: string; source: "follow_up" | "explicit" | "assistant_patch" }
  | { barePatch: string; source: "bare_number" }
  | { readPackageAndBumpPatch: true }
  | null {
  const followUp = resolveVersionBumpFollowUp(userText, history);
  if (followUp) {
    return { targetVersion: followUp.targetVersion, source: "follow_up" };
  }
  if (!looksLikeVersionChangeRequest(userText)) {
    return null;
  }
  const explicit = String(userText || "").match(
    /\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/
  );
  if (explicit?.[1]) {
    return { targetVersion: explicit[1], source: "explicit" };
  }
  // Голый patch-номер: «поменяй на 22» / «подними до 23» / «поставь на 22».
  // Точную semver соберём в resolveVersionBumpForPackageJson из версии с диска.
  const bare = String(userText || "")
    .toLowerCase()
    .match(/(?:на|до)\s+(\d{1,6})\s*\.?$/);
  if (bare?.[1]) {
    return { barePatch: bare[1], source: "bare_number" };
  }
  const reported = extractReportedAppVersion(lastAssistantText(history));
  if (reported) {
    const bumped = bumpPatchVersion(reported);
    if (bumped) {
      return { targetVersion: bumped, source: "assistant_patch" };
    }
  }
  return { readPackageAndBumpPatch: true };
}

/** Заменить поле version в JSON-тексте package.json (первое вхождение). */
export function applyPackageJsonVersion(
  content: string,
  newVersion: string
): { ok: true; previous: string; content: string } | { ok: false; error: string } {
  const re = /("version"\s*:\s*")([^"]+)(")/;
  const match = String(content || "").match(re);
  if (!match) {
    return { ok: false, error: "В package.json не найдено поле version" };
  }
  const previous = match[2];
  if (previous === newVersion) {
    return { ok: false, error: `already:${previous}` };
  }
  return {
    ok: true,
    previous,
    content: String(content).replace(re, `$1${newVersion}$3`),
  };
}

/** Извлечь top-level version из текста package.json (первое вхождение). */
export function extractPackageJsonVersion(content: string): string | null {
  const re = /"version"\s*:\s*"([^"]+)"/;
  const match = String(content || "").match(re);
  return match?.[1] || null;
}

/**
 * Детерминированный bump версии в package.json без LLM.
 * Трогает только top-level поле `version` (regex без флага g) — зависимости
 * и прочие поля не меняются и не удаляются.
 *
 * @returns
 *  - `{ kind: "bump", targetVersion, previous, newContent }` — записать newContent на диск;
 *  - `{ kind: "already", current }` — версия уже целевая, менять нечего;
 *  - `null` — запрос не похож на bump версии (провалить в обычный LLM-путь).
 */
export function resolveVersionBumpForPackageJson(
  userText: string,
  history: Array<{ role?: string; content?: unknown }>,
  packageJsonContent: string
):
  | { kind: "bump"; targetVersion: string; previous: string; newContent: string }
  | { kind: "already"; current: string }
  | null {
  const resolved = resolveLocalVersionBump(userText, history);
  if (!resolved) {
    return null;
  }
  let targetVersion: string | null;
  if ("readPackageAndBumpPatch" in resolved) {
    const current = extractPackageJsonVersion(packageJsonContent);
    if (!current) {
      return null;
    }
    targetVersion = bumpPatchVersion(current);
  } else if ("barePatch" in resolved) {
    // «поменяй на 22» — берём major.minor из package.json с диска, patch из запроса.
    const current = extractPackageJsonVersion(packageJsonContent);
    if (!current) {
      return null;
    }
    const parts = current.split(".");
    if (parts.length < 3) {
      return null;
    }
    const patchPart = String(resolved.barePatch).split("-")[0];
    targetVersion = `${parts[0]}.${parts[1]}.${patchPart}`;
  } else {
    targetVersion = resolved.targetVersion;
  }
  if (!targetVersion) {
    return null;
  }
  const applied = applyPackageJsonVersion(packageJsonContent, targetVersion);
  if (!applied.ok) {
    if (applied.error.startsWith("already:")) {
      return { kind: "already", current: applied.error.slice("already:".length) };
    }
    return null;
  }
  return {
    kind: "bump",
    targetVersion,
    previous: applied.previous,
    newContent: applied.content,
  };
}

/**
 * Guard (B): модель не должна записывать в package.json поле "version"
 * не-semver значением (например, голое "22" вместо "0.0.22"). Если модель
 * пытается — возвращаем ошибку инструмента, чтобы она либо поставила полную
 * semver, либо уточнила у пользователя текстом, а не угадывала.
 *
 * Возвращает строку-ошибку (JSON) либо null, если значение корректное
 * (или поле version отсутствует). Чистая функция без vscode — тестируется отдельно.
 */
export function validatePackageJsonVersionValue(
  resultingContent: string
): string | null {
  const version = extractPackageJsonVersion(resultingContent);
  if (version === null) {
    return null;
  }
  if (SEMVER_VERSION_RE.test(version)) {
    return null;
  }
  return JSON.stringify({
    error:
      `package.json "version" must be full semver (e.g. "0.0.22"), got ${JSON.stringify(version)}. ` +
      `Do not write a bare number into the version field. Either set a proper semver, ` +
      `or ask the user in plain text which version they meant — do not guess.`,
  });
}

/** «Уже так / менять нечего» при явном запросе на изменение. */
export function looksLikeRefusedRequestedEdit(text: string): boolean {
  const value = String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) {
    return false;
  }
  return hasAny(value, [
    "менять нечего",
    "менять не нужно",
    "уже установлена",
    "уже установлено",
    "уже стоит",
    "уже была",
    "уже было",
    "уже на месте",
    "nothing to change",
    "no changes needed",
    "already set to",
    "already at",
    "already is",
  ]);
}
