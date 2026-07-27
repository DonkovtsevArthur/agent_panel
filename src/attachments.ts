import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import type { ContentPart } from "./openaiClient";

export type AttachmentKind = "image" | "file";

/** Метаданные вложения — без тяжёлых payload в store. */
export interface MessageAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  /** Путь относительно корня workspace */
  path?: string;
  /** Путь относительно ExtensionContext.storageUri */
  storageKey?: string;
  size?: number;
  /** Только на wire / в webview, не в workspaceState */
  dataBase64?: string;
  /** Только для UI-превью, не в workspaceState */
  previewDataUrl?: string;
}

export interface IncomingAttachment {
  id?: string;
  kind?: AttachmentKind;
  name: string;
  mime?: string;
  path?: string;
  storageKey?: string;
  size?: number;
  dataBase64?: string;
}

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
]);

const TEXT_EXT = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".css",
  ".scss",
  ".html",
  ".htm",
  ".xml",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".cfg",
  ".env",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".swift",
  ".sql",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".dockerfile",
  ".gitignore",
  ".editorconfig",
  ".vue",
  ".svelte",
  ".graphql",
  ".csv",
  ".tsv",
  ".log",
]);

export const MAX_ATTACHMENTS = 8;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_CHARS = 40_000;

export function newAttachmentId(): string {
  return `att_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function guessMime(fileName: string, fallback = "application/octet-stream"): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".html":
    case ".htm":
      return "text/html";
    case ".css":
      return "text/css";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "text/javascript";
    case ".ts":
    case ".tsx":
      return "text/typescript";
    case ".txt":
    case ".log":
      return "text/plain";
    default:
      return fallback;
  }
}

export function isImageAttachment(name: string, mime?: string): boolean {
  if (mime && mime.startsWith("image/") && mime !== "image/svg+xml") {
    return true;
  }
  return IMAGE_EXT.has(path.extname(name).toLowerCase());
}

function isProbablyTextFile(name: string, mime?: string): boolean {
  if (mime?.startsWith("text/")) {
    return true;
  }
  if (
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript"
  ) {
    return true;
  }
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXT.has(ext)) {
    return true;
  }
  if (!ext && name.toUpperCase().startsWith("Dockerfile")) {
    return true;
  }
  return false;
}

export function stripAttachmentPayload(
  attachment: MessageAttachment
): MessageAttachment {
  const { dataBase64: _b, previewDataUrl: _p, ...rest } = attachment;
  return rest;
}

export function stripUiAttachmentPayloads(
  messages: Array<{ attachments?: MessageAttachment[] }>
): void {
  for (const msg of messages) {
    if (!msg.attachments?.length) {
      continue;
    }
    msg.attachments = msg.attachments.map(stripAttachmentPayload);
  }
}

function workspaceRelative(uri: vscode.Uri): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  for (const folder of folders) {
    const rel = path.relative(folder.uri.fsPath, uri.fsPath);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return rel.split(path.sep).join("/");
    }
    if (uri.fsPath === folder.uri.fsPath) {
      return "";
    }
  }
  return undefined;
}

async function ensureStorageDir(storageUri: vscode.Uri): Promise<vscode.Uri> {
  const dir = vscode.Uri.joinPath(storageUri, "attachments");
  await fs.mkdir(dir.fsPath, { recursive: true });
  return dir;
}

export async function persistIncomingAttachments(
  incoming: IncomingAttachment[] | undefined,
  storageUri: vscode.Uri | undefined
): Promise<MessageAttachment[]> {
  if (!incoming?.length) {
    return [];
  }

  const result: MessageAttachment[] = [];
  for (const item of incoming.slice(0, MAX_ATTACHMENTS)) {
    const name = String(item.name || "file").trim() || "file";
    const mime = item.mime || guessMime(name);
    const kind: AttachmentKind =
      item.kind || (isImageAttachment(name, mime) ? "image" : "file");
    const id = item.id || newAttachmentId();

    if (item.path) {
      result.push({
        id,
        kind,
        name,
        mime,
        path: item.path.replace(/\\/g, "/"),
        size: item.size,
      });
      continue;
    }

    if (item.storageKey && !item.dataBase64) {
      result.push({
        id,
        kind,
        name,
        mime,
        storageKey: item.storageKey,
        size: item.size,
      });
      continue;
    }

    if (item.dataBase64 && storageUri) {
      const buf = Buffer.from(item.dataBase64, "base64");
      if (kind === "image" && buf.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(
          `Изображение «${name}» слишком большое (макс. ${Math.round(
            MAX_IMAGE_BYTES / 1024 / 1024
          )} МБ)`
        );
      }
      const dir = await ensureStorageDir(storageUri);
      const ext =
        path.extname(name) ||
        (mime === "image/png"
          ? ".png"
          : mime === "image/jpeg"
            ? ".jpg"
            : mime === "image/webp"
              ? ".webp"
              : mime === "image/gif"
                ? ".gif"
                : ".bin");
      const storageKey = `attachments/${id}${ext}`;
      const target = vscode.Uri.joinPath(storageUri, ...storageKey.split("/"));
      await fs.writeFile(target.fsPath, buf);
      result.push({
        id,
        kind,
        name,
        mime,
        storageKey,
        size: buf.byteLength,
      });
      continue;
    }

    if (item.path || item.storageKey) {
      result.push({
        id,
        kind,
        name,
        mime,
        path: item.path,
        storageKey: item.storageKey,
        size: item.size,
      });
    }
  }
  return result;
}

export async function attachmentsFromUris(
  uriStrings: string[]
): Promise<MessageAttachment[]> {
  const result: MessageAttachment[] = [];
  for (const raw of uriStrings.slice(0, MAX_ATTACHMENTS)) {
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(raw);
    } catch {
      continue;
    }
    if (uri.scheme !== "file") {
      continue;
    }
    const name = path.basename(uri.fsPath);
    const mime = guessMime(name);
    const kind: AttachmentKind = isImageAttachment(name, mime)
      ? "image"
      : "file";
    const rel = workspaceRelative(uri);
    let size: number | undefined;
    try {
      const stat = await fs.stat(uri.fsPath);
      size = stat.size;
      if (kind === "image" && size > MAX_IMAGE_BYTES) {
        throw new Error(
          `Изображение «${name}» слишком большое (макс. ${Math.round(
            MAX_IMAGE_BYTES / 1024 / 1024
          )} МБ)`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("слишком большое")) {
        throw error;
      }
    }

    if (rel !== undefined) {
      result.push({
        id: newAttachmentId(),
        kind,
        name,
        mime,
        path: rel,
        size,
      });
      continue;
    }

    // Вне workspace — копируем в storage при следующей persist; пока читаем в base64-путь через storage later
    const data = await fs.readFile(uri.fsPath);
    if (kind === "image" && data.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(
        `Изображение «${name}» слишком большое (макс. ${Math.round(
          MAX_IMAGE_BYTES / 1024 / 1024
        )} МБ)`
      );
    }
    result.push({
      id: newAttachmentId(),
      kind,
      name,
      mime,
      size: data.byteLength,
      dataBase64: data.toString("base64"),
    });
  }
  return result;
}

export async function pickWorkspaceAttachments(): Promise<MessageAttachment[]> {
  const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    canSelectFiles: true,
    canSelectFolders: false,
    defaultUri,
    openLabel: "Прикрепить",
    filters: {
      "Изображения и текст": [
        "png",
        "jpg",
        "jpeg",
        "gif",
        "webp",
        "bmp",
        "txt",
        "md",
        "json",
        "ts",
        "tsx",
        "js",
        "jsx",
        "css",
        "html",
        "py",
        "go",
        "rs",
        "yml",
        "yaml",
      ],
      "Все файлы": ["*"],
    },
  });
  if (!uris?.length) {
    return [];
  }
  return attachmentsFromUris(uris.map((u) => u.toString()));
}

async function readAttachmentBytes(
  attachment: MessageAttachment,
  storageUri: vscode.Uri | undefined
): Promise<Buffer | undefined> {
  if (attachment.dataBase64) {
    return Buffer.from(attachment.dataBase64, "base64");
  }
  if (attachment.path) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      return undefined;
    }
    const uri = vscode.Uri.joinPath(folders[0].uri, attachment.path);
    return fs.readFile(uri.fsPath);
  }
  if (attachment.storageKey && storageUri) {
    const uri = vscode.Uri.joinPath(
      storageUri,
      ...attachment.storageKey.split("/")
    );
    return fs.readFile(uri.fsPath);
  }
  return undefined;
}

export async function attachmentPreviewDataUrl(
  attachment: MessageAttachment,
  storageUri: vscode.Uri | undefined
): Promise<string | undefined> {
  if (attachment.kind !== "image") {
    return undefined;
  }
  if (attachment.previewDataUrl) {
    return attachment.previewDataUrl;
  }
  if (attachment.dataBase64) {
    return `data:${attachment.mime || "image/png"};base64,${attachment.dataBase64}`;
  }
  try {
    const bytes = await readAttachmentBytes(attachment, storageUri);
    if (!bytes) {
      return undefined;
    }
    return `data:${attachment.mime || "image/png"};base64,${bytes.toString(
      "base64"
    )}`;
  } catch {
    return undefined;
  }
}

export async function enrichAttachmentsForUi(
  attachments: MessageAttachment[] | undefined,
  storageUri: vscode.Uri | undefined
): Promise<MessageAttachment[]> {
  if (!attachments?.length) {
    return [];
  }
  const out: MessageAttachment[] = [];
  for (const att of attachments) {
    const clean = stripAttachmentPayload(att);
    if (clean.kind === "image") {
      const preview = await attachmentPreviewDataUrl(att, storageUri);
      if (preview) {
        out.push({ ...clean, previewDataUrl: preview });
        continue;
      }
    }
    out.push(clean);
  }
  return out;
}

function truncateText(text: string, max = MAX_TEXT_CHARS): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n\n[truncated]`;
}

async function fileTextExcerpt(
  attachment: MessageAttachment
): Promise<string | undefined> {
  if (!attachment.path) {
    return undefined;
  }
  if (!isProbablyTextFile(attachment.name, attachment.mime)) {
    return `Файл (бинарный или неизвестный тип): ${attachment.path}`;
  }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  try {
    const uri = vscode.Uri.joinPath(folders[0].uri, attachment.path);
    const raw = await fs.readFile(uri.fsPath, "utf8");
    return truncateText(raw);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return `Не удалось прочитать ${attachment.path}: ${text}`;
  }
}

/**
 * Собирает content для API: текст + файлы; картинки — multimodal parts.
 */
export async function buildUserApiContent(
  userText: string,
  attachments: MessageAttachment[] | undefined,
  storageUri: vscode.Uri | undefined
): Promise<string | ContentPart[]> {
  const text = String(userText || "").trim();
  const list = attachments || [];
  if (!list.length) {
    return text;
  }

  const textChunks: string[] = [];
  if (text) {
    textChunks.push(text);
  }

  const imageParts: ContentPart[] = [];

  for (const att of list) {
    if (att.kind === "image") {
      const bytes = await readAttachmentBytes(att, storageUri);
      if (!bytes) {
        textChunks.push(`[Изображение недоступно: ${att.name}]`);
        continue;
      }
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        textChunks.push(
          `[Изображение «${att.name}» пропущено: слишком большое]`
        );
        continue;
      }
      const mime = att.mime || guessMime(att.name, "image/png");
      imageParts.push({
        type: "image_url",
        image_url: {
          url: `data:${mime};base64,${bytes.toString("base64")}`,
        },
      });
      continue;
    }

    const label = att.path || att.name;
    const excerpt = await fileTextExcerpt(att);
    if (excerpt && excerpt.startsWith("Файл (бинарный")) {
      textChunks.push(`Прикреплён файл: ${label} (${att.mime || "binary"})`);
    } else if (excerpt) {
      textChunks.push(
        `Прикреплённый файл \`${label}\`:\n\`\`\`\n${excerpt}\n\`\`\``
      );
    } else {
      textChunks.push(`Прикреплён файл: ${label}`);
    }
  }

  const combinedText = textChunks.join("\n\n").trim();

  if (!imageParts.length) {
    return combinedText || text || "(вложение)";
  }

  const parts: ContentPart[] = [];
  if (combinedText) {
    parts.push({ type: "text", text: combinedText });
  } else {
    parts.push({ type: "text", text: "Что на изображении? Опиши и помоги." });
  }
  parts.push(...imageParts);
  return parts;
}

/** Текст для history / regenerate без base64. */
export function userContentForHistory(
  userText: string,
  attachments: MessageAttachment[] | undefined
): string {
  const text = String(userText || "").trim();
  const list = attachments || [];
  if (!list.length) {
    return text;
  }
  const notes = list.map((att) => {
    if (att.kind === "image") {
      return `[image: ${att.name}]`;
    }
    return `[file: ${att.path || att.name}]`;
  });
  return [text, ...notes].filter(Boolean).join("\n");
}
