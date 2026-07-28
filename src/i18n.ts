import * as vscode from "vscode";

export type UiLanguage = "en" | "ru";
export type UiLanguageSetting = "auto" | UiLanguage;

export function resolveUiLanguage(setting: UiLanguageSetting): UiLanguage {
  if (setting === "en" || setting === "ru") {
    return setting;
  }
  const raw = String(vscode.env.language || "").toLowerCase();
  return raw.startsWith("ru") ? "ru" : "en";
}

export function defaultSystemPromptForLanguage(lang: UiLanguage): string {
  if (lang === "ru") {
    return "Ты — coding-агент в VS Code. Отвечай кратко на русском. В каждом запросе тебе передаются дата/время и состояние редактора (активный файл, курсор, выделение, открытые вкладки) — опирайся на них. У тебя есть инструменты: list_files, read_file, write_file, run_command, fetch_url, open_external. Для git status/log/diff и любых shell-команд используй run_command — не проси пользователя запускать их вручную. Чтобы прочитать содержимое http(s) ссылки, вызывай fetch_url; чтобы открыть ссылку в браузере пользователя — open_external. Никогда не пиши, что не можешь открывать внешние URL.";
  }
  return "You are a coding agent in VS Code. Reply concisely in English. Each request includes the current date/time and editor state (active file, cursor, selection, open tabs) — use it. You have these tools: list_files, read_file, write_file, run_command, fetch_url, open_external. For git status/log/diff and any shell command, use run_command instead of asking the user to run it manually. To read an http(s) link, call fetch_url; to open it in the user's browser, call open_external. Never claim you cannot open external URLs.";
}

export function defaultProviderNameForLanguage(lang: UiLanguage): string {
  return lang === "ru" ? "Основной" : "Default";
}
