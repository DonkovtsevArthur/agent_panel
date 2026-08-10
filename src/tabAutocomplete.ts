/**
 * Inline Tab autocomplete for Harbor Agents.
 *
 * UX (debounce, skip filters, accept tracking) adapted from TabCoder
 * `vendor/tabcoder` (Apache-2.0). LLM calls use Harbor openai-compatible
 * client + Settings providers — not TabCoder AI SDK / profiles.
 */

import * as path from "path";
import * as vscode from "vscode";
import {
  getConfig,
  getEnabledModels,
  resolveModelEndpoint,
} from "./config";
import { getOpenAICompatibleClient } from "./openaiClient";
import {
  DefaultHoleFiller,
  refineCompletionText,
  type AutoCompleteContext,
} from "./tabAutocompleteHoleFiller";

const COMPLETION_ACCEPTED_CMD = "agentPanel.tabAutocomplete.completionAccepted";
const STATUS_CLICK_CMD = "agentPanel.tabAutocomplete.statusBarClicked";
const MAX_COMPLETION_TOKENS = 128;
/** Keep prompts small for corporate gateways / latency. */
const MAX_PREFIX_CHARS = 3_500;
const MAX_SUFFIX_CHARS = 800;
const CACHE_LIMIT = 40;

function debounceMsForAggressiveness(
  level: "low" | "medium" | "high",
  fastTrigger: boolean
): number {
  if (level === "low") {
    return fastTrigger ? 280 : 550;
  }
  if (level === "high") {
    return fastTrigger ? 60 : 140;
  }
  return fastTrigger ? 120 : 280;
}

const SKIP_PATH_RE =
  /(^|[/\\])(\.env(\..+)?|.*\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|lock|min\.js|min\.css|map|wasm|woff2?|ttf|eot)|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock)$/i;

let output: vscode.OutputChannel | undefined;

function log(message: string, ...rest: unknown[]): void {
  if (!output) {
    output = vscode.window.createOutputChannel("Harbor Tab Autocomplete");
  }
  const extra =
    rest.length > 0
      ? " " +
        rest
          .map((r) => {
            if (r instanceof Error) {
              return r.stack || r.message;
            }
            try {
              return JSON.stringify(r);
            } catch {
              return String(r);
            }
          })
          .join(" ")
      : "";
  output.appendLine(`[${new Date().toISOString()}] ${message}${extra}`);
}

function delay(ms: number, token: vscode.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    if (token.isCancellationRequested) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => resolve(true), ms);
    const sub = token.onCancellationRequested(() => {
      clearTimeout(timer);
      sub.dispose();
      resolve(false);
    });
  });
}

function truncatePrefix(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

function truncateSuffix(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max);
}

function shouldSkipDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
    return true;
  }
  if (document.isClosed) {
    return true;
  }
  const name = document.fileName || document.uri.fsPath || "";
  if (SKIP_PATH_RE.test(name)) {
    return true;
  }
  // Huge files — too expensive / noisy.
  if (document.lineCount > 8_000) {
    return true;
  }
  return false;
}

type CachedSuggestion = {
  uri: string;
  prefixTail: string;
  suffixHead: string;
  text: string;
  modelId: string;
  at: number;
};

class SuggestionCache {
  private readonly items: CachedSuggestion[] = [];

  get(
    uri: string,
    prefix: string,
    suffix: string,
    modelId: string
  ): string | undefined {
    const prefixTail = prefix.slice(-240);
    const suffixHead = suffix.slice(0, 120);

    for (const item of this.items) {
      if (item.uri !== uri || item.modelId !== modelId) {
        continue;
      }
      if (item.suffixHead !== suffixHead) {
        continue;
      }
      if (item.prefixTail === prefixTail) {
        return item.text;
      }
      // User typed further into a previous suggestion — return remainder.
      if (
        prefixTail.length > item.prefixTail.length &&
        prefixTail.startsWith(item.prefixTail)
      ) {
        const typed = prefixTail.slice(item.prefixTail.length);
        if (typed && item.text.startsWith(typed)) {
          return item.text.slice(typed.length);
        }
      }
    }
    return undefined;
  }

  set(
    uri: string,
    prefix: string,
    suffix: string,
    modelId: string,
    text: string
  ): void {
    const entry: CachedSuggestion = {
      uri,
      prefixTail: prefix.slice(-240),
      suffixHead: suffix.slice(0, 120),
      text,
      modelId,
      at: Date.now(),
    };
    this.items.unshift(entry);
    if (this.items.length > CACHE_LIMIT) {
      this.items.length = CACHE_LIMIT;
    }
  }
}

class TabAutocompleteStatusBar {
  private readonly item: vscode.StatusBarItem;
  private readonly activeRequests = new Set<number>();
  private lastError: string | undefined;
  private lastLatencyMs: number | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.item.command = STATUS_CLICK_CMD;
    this.refresh();
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }

  onStart(requestId: number): void {
    this.activeRequests.add(requestId);
    this.lastError = undefined;
    this.refresh();
  }

  onEnd(requestId: number, latencyMs?: number): void {
    this.activeRequests.delete(requestId);
    if (typeof latencyMs === "number") {
      this.lastLatencyMs = latencyMs;
    }
    this.refresh();
  }

  setError(message: string): void {
    this.lastError = message;
    this.refresh();
  }

  refresh(): void {
    const config = getConfig();
    const enabled = config.tabAutocomplete.enabled;
    const modelId = config.tabAutocomplete.modelId.trim();
    const model = getEnabledModels().find((m) => m.id === modelId);
    const label = model?.label || modelId || "—";

    if (this.activeRequests.size > 0) {
      this.item.text = `$(sync~spin) Tab: ${label}`;
      this.item.tooltip = `Harbor Tab autocomplete generating (${this.activeRequests.size})`;
      return;
    }

    if (!enabled) {
      this.item.text = "$(code) Tab: Off";
      this.item.tooltip =
        "Harbor Tab autocomplete is off. Enable it in Harbor Agents Settings.";
      return;
    }

    if (!modelId || !model) {
      this.item.text = "$(code) Tab: No model";
      this.item.tooltip =
        "Choose a Tab autocomplete model in Harbor Agents Settings.";
      return;
    }

    if (this.lastError) {
      this.item.text = `$(warning) Tab: ${label}`;
      this.item.tooltip = `Tab error: ${this.lastError}\nOpen Output → Harbor Tab Autocomplete for details.`;
      return;
    }

    const latency =
      typeof this.lastLatencyMs === "number"
        ? ` · last ${this.lastLatencyMs}ms`
        : "";
    this.item.text = `$(code) Tab: ${label}`;
    this.item.tooltip = `Harbor Tab autocomplete · ${label}${latency}`;
  }
}

class HarborTabInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private currentAbortController: AbortController | undefined;
  private requestCounter = 0;
  private lastAcceptedCompletion:
    | { text: string; position: vscode.Position; timestamp: number }
    | undefined;
  private readonly holeFiller = new DefaultHoleFiller();
  private readonly cache = new SuggestionCache();

  constructor(private readonly statusBar: TabAutocompleteStatusBar) {}

  onCompletionAccepted(text: string, position: vscode.Position): void {
    this.lastAcceptedCompletion = {
      text,
      position,
      timestamp: Date.now(),
    };
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
    const config = getConfig();
    if (!config.tabAutocomplete.enabled) {
      return [];
    }
    const modelId = config.tabAutocomplete.modelId.trim();
    if (!modelId) {
      return [];
    }
    if (!getEnabledModels().some((m) => m.id === modelId)) {
      return [];
    }
    if (shouldSkipDocument(document)) {
      return [];
    }
    if (this.shouldSkipRequest(document, position, context)) {
      return [];
    }

    const textBeforeCursor = truncatePrefix(
      document.getText(new vscode.Range(new vscode.Position(0, 0), position)),
      MAX_PREFIX_CHARS
    );
    const lastLine = document.lineAt(document.lineCount - 1);
    const textAfterCursor = truncateSuffix(
      document.getText(
        new vscode.Range(
          position,
          new vscode.Position(document.lineCount - 1, lastLine.text.length)
        )
      ),
      MAX_SUFFIX_CHARS
    );

    // Instant reuse when the user is typing through a cached suggestion.
    const cached = this.cache.get(
      document.uri.toString(),
      textBeforeCursor,
      textAfterCursor,
      modelId
    );
    if (cached) {
      log("cache hit", cached.slice(0, 80).replace(/\n/g, "\\n"));
      return [
        this.toItem(cached, position),
      ];
    }

    if (this.requestCounter >= Number.MAX_SAFE_INTEGER) {
      this.requestCounter = 0;
    }
    const currentRequestId = ++this.requestCounter;

    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = undefined;
    }

    // Faster debounce after trigger chars (; { ( = , space newline).
    const charBefore =
      position.character > 0
        ? document.lineAt(position.line).text.charAt(position.character - 1)
        : "";
    const fastTrigger = /[;{}\n=,(\[]/.test(charBefore) || charBefore === " ";
    const debounceMs = debounceMsForAggressiveness(
      config.tabAutocomplete.aggressiveness,
      fastTrigger
    );

    const stillActive = await delay(debounceMs, token);
    if (!stillActive || !this.isRequestStillValid(currentRequestId, token)) {
      return [];
    }

    this.statusBar.onStart(currentRequestId);
    const started = Date.now();
    try {
      const result = await this.generateCompletion(
        document,
        position,
        token,
        modelId,
        currentRequestId,
        textBeforeCursor,
        textAfterCursor
      );
      this.statusBar.onEnd(currentRequestId, Date.now() - started);
      return result;
    } catch {
      this.statusBar.onEnd(currentRequestId);
      return [];
    }
  }

  private toItem(
    text: string,
    position: vscode.Position
  ): vscode.InlineCompletionItem {
    const item = new vscode.InlineCompletionItem(
      text,
      new vscode.Range(position, position)
    );
    item.command = {
      command: COMPLETION_ACCEPTED_CMD,
      title: "Track Tab completion",
      arguments: [text, position],
    };
    return item;
  }

  private shouldSkipRequest(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext
  ): boolean {
    const currentTime = Date.now();
    const currentLine = document.lineAt(position.line);

    if (context.selectedCompletionInfo) {
      return true;
    }

    if (
      this.lastAcceptedCompletion &&
      currentTime - this.lastAcceptedCompletion.timestamp < 800
    ) {
      const completionLines = this.lastAcceptedCompletion.text.split("\n");
      let expectedEndPosition: vscode.Position;
      if (completionLines.length === 1) {
        expectedEndPosition = new vscode.Position(
          this.lastAcceptedCompletion.position.line,
          this.lastAcceptedCompletion.position.character +
            this.lastAcceptedCompletion.text.length
        );
      } else {
        expectedEndPosition = new vscode.Position(
          this.lastAcceptedCompletion.position.line +
            completionLines.length -
            1,
          completionLines[completionLines.length - 1].length
        );
      }
      if (
        position.line === expectedEndPosition.line &&
        Math.abs(position.character - expectedEndPosition.character) <= 1
      ) {
        return true;
      }
    }

    const charAtCursor = currentLine.text.charAt(position.character);
    const charBeforeCursor =
      position.character > 0
        ? currentLine.text.charAt(position.character - 1)
        : "";
    if (
      charAtCursor &&
      /\w/.test(charAtCursor) &&
      /\w/.test(charBeforeCursor)
    ) {
      return true;
    }

    // Empty brand-new file with almost no signal — wait for a bit of context.
    if (document.lineCount <= 1 && currentLine.text.trim().length < 2) {
      return true;
    }

    return false;
  }

  private async generateCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    modelId: string,
    requestId: number,
    textBeforeCursor: string,
    textAfterCursor: string
  ): Promise<vscode.InlineCompletionItem[]> {
    if (!this.isRequestStillValid(requestId, token)) {
      return [];
    }

    const params: AutoCompleteContext = {
      textBeforeCursor,
      textAfterCursor,
      filename: path.basename(document.fileName || document.uri.fsPath || ""),
      language: document.languageId,
      currentLineText: document.lineAt(position.line).text,
    };

    this.currentAbortController = new AbortController();
    const tokenListener = token.onCancellationRequested(() => {
      this.currentAbortController?.abort();
    });

    try {
      const endpoint = resolveModelEndpoint(modelId);
      if (!endpoint.baseUrl) {
        const msg = "no provider baseUrl for model";
        log(msg, modelId);
        this.statusBar.setError(msg);
        return [];
      }

      const config = getConfig();
      const client = getOpenAICompatibleClient(
        endpoint.baseUrl,
        endpoint.apiKey || "",
        {
          rejectUnauthorized: config.rejectUnauthorized,
          caBundlePath: config.caBundlePath,
        }
      );

      const { messages } = this.holeFiller.prompt(params);
      const sameLineSuffix = (textAfterCursor.split("\n")[0] || "");
      const maxTokens =
        sameLineSuffix.length > 0 ? 48 : MAX_COMPLETION_TOKENS;

      log("request", {
        modelId,
        providerId: endpoint.providerId,
        prefixLen: textBeforeCursor.length,
        suffixLen: textAfterCursor.length,
        language: document.languageId,
        maxTokens,
      });

      const result = await client.chatCompletions(
        {
          model: modelId,
          messages,
          temperature: 0.1,
          max_tokens: maxTokens,
        },
        this.currentAbortController.signal
      );

      if (!this.isRequestStillValid(requestId, token)) {
        return [];
      }

      const content = result.message.content;
      const raw =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .map((part) =>
                  part && typeof part === "object" && "text" in part
                    ? String((part as { text?: string }).text || "")
                    : ""
                )
                .join("")
            : "";

      if (!raw) {
        log("empty model response");
        return [];
      }

      const response = refineCompletionText(raw, params);
      if (!response.trim()) {
        log("empty after refine", raw.slice(0, 200));
        return [];
      }

      this.cache.set(
        document.uri.toString(),
        textBeforeCursor,
        textAfterCursor,
        modelId,
        response
      );

      log("suggestion", response.slice(0, 120).replace(/\n/g, "\\n"));
      return [this.toItem(response, position)];
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || /abort/i.test(error.message))
      ) {
        return [];
      }
      const msg = error instanceof Error ? error.message : String(error);
      log("error", error);
      this.statusBar.setError(msg.slice(0, 120));
      return [];
    } finally {
      tokenListener.dispose();
    }
  }

  private isRequestStillValid(
    requestId: number,
    token: vscode.CancellationToken
  ): boolean {
    return requestId === this.requestCounter && !token.isCancellationRequested;
  }
}

/**
 * Register Tab autocomplete (inline ghost text) for Harbor Agents.
 */
export function startTabAutocomplete(
  context: vscode.ExtensionContext
): void {
  const statusBar = new TabAutocompleteStatusBar();
  const provider = new HarborTabInlineCompletionProvider(statusBar);
  output = vscode.window.createOutputChannel("Harbor Tab Autocomplete");

  const ensureInlineSuggest = async () => {
    if (!getConfig().tabAutocomplete.enabled) {
      return;
    }
    const cfg = vscode.workspace.getConfiguration("editor");
    if (cfg.get<boolean>("inlineSuggest.enabled") === false) {
      log("editor.inlineSuggest.enabled is false — enabling for Tab");
      await cfg.update(
        "inlineSuggest.enabled",
        true,
        vscode.ConfigurationTarget.Global
      );
    }
  };
  void ensureInlineSuggest();

  context.subscriptions.push(
    statusBar,
    output,
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: "**" },
      provider
    ),
    vscode.commands.registerCommand(
      COMPLETION_ACCEPTED_CMD,
      (text: string, position: vscode.Position) => {
        if (typeof text === "string" && position) {
          provider.onCompletionAccepted(text, position);
        }
      }
    ),
    vscode.commands.registerCommand(STATUS_CLICK_CMD, () => {
      output?.show(true);
      void vscode.commands.executeCommand("agentPanel.openSettings");
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("agentPanel.tabAutocomplete") ||
        e.affectsConfiguration("agentPanel.models") ||
        e.affectsConfiguration("agentPanel.providers")
      ) {
        statusBar.refresh();
        void ensureInlineSuggest();
      }
    })
  );

  log("Tab autocomplete registered", {
    enabled: getConfig().tabAutocomplete.enabled,
    modelId: getConfig().tabAutocomplete.modelId,
  });
}
