
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const FILE_EXT =
    "ts|tsx|js|jsx|mjs|cjs|json|css|scss|less|sass|md|mdx|py|go|rs|java|kt|kts|vue|svelte|html|htm|yml|yaml|toml|xml|svg|sh|bash|zsh|env|lock|swift|dart|php|rb|cs|cpp|cc|cxx|h|hpp|sql|graphql|gql|proto|txt|csv|gitignore|dockerignore|editorconfig";

  function isFilePath(value) {
    const s = String(value || "").trim();
    if (!s || /\s/.test(s) || s.includes("://")) {
      return false;
    }
    if (/^https?:\/\//i.test(s)) {
      return false;
    }
    if (s.includes("/")) {
      if (new RegExp(`\\.(?:${FILE_EXT})$`, "i").test(s)) {
        return true;
      }
      if (/^(?:\.\/|\.\.\/)?(?:[\w.\u2026-]+\/)+[\w.\u2026-]+$/.test(s)) {
        return true;
      }
      return false;
    }
    return new RegExp(`^[\\w.-]+\\.(?:${FILE_EXT})$`, "i").test(s);
  }

  function fileLinkHtml(path) {
    const full = String(path || "");
    const safePath = escapeHtml(full);
    const label = escapeHtml(pathBasename(full));
    return `<a class="md-file" href="#" data-path="${safePath}" title="${safePath}">${label}</a>`;
  }

  function splitTrailingPunctuation(url) {
    let href = String(url);
    let trailing = "";
    while (href.length > 8 && /[*_~.,);:!?]$/.test(href)) {
      trailing = href.slice(-1) + trailing;
      href = href.slice(0, -1);
    }
    return { href, trailing };
  }

  // Chat models glue sentence punctuation onto file paths ("…see foo.ts.");
  // a trailing dot/comma must stay outside the clickable link.
  function splitFilePathPunctuation(path) {
    let href = String(path);
    let trailing = "";
    while (href.length > 4 && /[.,;:!?)\]]$/.test(href)) {
      trailing = href.slice(-1) + trailing;
      href = href.slice(0, -1);
    }
    return { href, trailing };
  }

  function linkifyPlainText(raw, alreadyEscaped) {
    const tokens = [];
    let text = String(raw || "");

    text = text.replace(/@([^\s@]+)/g, (full, path) => {
      const id = tokens.length;
      tokens.push(renderMentionChip(path));
      return `\u0001T${id}\u0001`;
    });

    text = text.replace(/(https?:\/\/[^\s<>"'`]+)/g, (url) => {
      const { href, trailing } = splitTrailingPunctuation(url);
      if (!/^https?:\/\/\S+$/i.test(href)) {
        return url;
      }
      const id = tokens.length;
      tokens.push(
        `<a class="md-link" href="${escapeHtml(href)}" data-href="${escapeHtml(
          href
        )}">${escapeHtml(href)}</a>`
      );
      return `\u0001T${id}\u0001${trailing}`;
    });

    text = text.replace(
      new RegExp(
        `(?<![\\w./-])((?:\\.?\\.?/)?(?:[\\w.\\u2026-]+/)+[\\w.\\u2026-]+(?:\\.(?:${FILE_EXT}))?|[\\w.\\u2026-]+\\.(?:${FILE_EXT}))(?![\\w./-])`,
        "gi"
      ),
      (full, path) => {
        const { href, trailing } = splitFilePathPunctuation(path);
        if (!isFilePath(href)) {
          return full;
        }
        const id = tokens.length;
        tokens.push(fileLinkHtml(href));
        return `\u0001T${id}\u0001${trailing}`;
      }
    );

    const html = (alreadyEscaped ? text : escapeHtml(text)).replace(
      /\u0001T(\d+)\u0001/g,
      (_, id) => tokens[Number(id)] || ""
    );
    return html;
  }

  function parseCodeFenceMeta(langRaw) {
    const lang = String(langRaw || "").trim();
    if (!lang) {
      return { language: "", path: "", startLine: 0, endLine: 0 };
    }
    // language start:end:path  (напр. css 27:29:src/foo.module.css)
    const langCite = lang.match(
      /^([\w.+#-]+)\s+(\d+)(?::(\d+))?:(.+)$/
    );
    if (langCite) {
      return {
        language: langCite[1],
        path: langCite[4].trim(),
        startLine: Number(langCite[2]),
        endLine: langCite[3] ? Number(langCite[3]) : Number(langCite[2]),
      };
    }
    // start:end:path  или  start:path
    const cite = lang.match(/^(\d+)(?::(\d+))?:(.+)$/);
    if (cite) {
      const startLine = Number(cite[1]);
      const endLine = cite[2] ? Number(cite[2]) : startLine;
      return {
        language: "",
        path: cite[3].trim(),
        startLine,
        endLine,
      };
    }
    // language path:start-end  /  language path:start
    const withPath = lang.match(
      /^([\w.+#-]+)\s+(.+?):(\d+)(?:-(\d+))?$/
    );
    if (withPath) {
      return {
        language: withPath[1],
        path: withPath[2].trim(),
        startLine: Number(withPath[3]),
        endLine: withPath[4] ? Number(withPath[4]) : Number(withPath[3]),
      };
    }
    // language path
    const langPath = lang.match(/^([\w.+#-]+)\s+(\S.+)$/);
    if (langPath && (langPath[2].includes("/") || langPath[2].includes("."))) {
      return {
        language: langPath[1],
        path: langPath[2].trim(),
        startLine: 0,
        endLine: 0,
      };
    }
    return { language: lang, path: "", startLine: 0, endLine: 0 };
  }

  /**
   * Citation-fence ```start:end:path ... ``` — вытаскиваем до marked,
   * чтобы пути вроде foo.module.css и CSS с ~= не ломали разбор.
   */
  function renderUserFileChip(meta) {
    const path = meta.path || "file";
    const suffix =
      meta.startLine > 0
        ? meta.startLine === meta.endLine
          ? `:${meta.startLine}`
          : `:${meta.startLine}-${meta.endLine}`
        : "";
    return renderMentionChip(`${path}${suffix}`);
  }

  /** File chips (@path / citation fences) go above the user text, not inline. */
  function extractUserFileChips(raw) {
    const chips = [];
    const cited = replaceCitationFences(String(raw || ""), true);
    for (const html of cited.blocks) {
      if (html) {
        chips.push(html);
      }
    }
    let text = cited.text.replace(/\u0002CITE\d+\u0002/g, "");
    text = text.replace(/@([^\s@]+)/g, (full, path) => {
      if (String(path).includes("://")) {
        return full;
      }
      chips.push(renderMentionChip(path));
      return "";
    });
    text = text
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return { chips, text };
  }

  function replaceCitationFences(raw, compact) {
    const blocks = [];
    // ```27:29:path/to/file.module.css ... ```
    const re =
      /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*(\d+:\d+:[^\n]+|\d+:[^\n]+)\r?\n([\s\S]*?)\r?\n?[ \t]*\2[ \t]*(?=\r?\n|$)/g;
    const out = String(raw || "").replace(
      re,
      (full, lead, _fence, meta, body) => {
        const id = blocks.length;
        blocks.push(
          compact
            ? renderUserFileChip(parseCodeFenceMeta(meta.trim()))
            : renderCodeBlockHtml(body.replace(/\r/g, ""), meta.trim())
        );
        return `${lead}\n\n\u0002CITE${id}\u0002\n\n`;
      }
    );
    return { text: out, blocks };
  }

  function restoreCitationFences(html, blocks) {
    if (!blocks.length) {
      return html;
    }
    return String(html || "").replace(/\u0002CITE(\d+)\u0002/g, (_, id) => {
      return blocks[Number(id)] || "";
    });
  }

  /**
   * <proposed_plan>…</proposed_plan> — plan block with Build button.
   * Called on raw assistant text BEFORE marked.parse, so match raw tags.
   * Also accept escaped form for re-renders / history edge cases.
   */
  function replaceProposedPlanBlocks(raw) {
    const blocks = [];
    const re =
      /(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*([\s\S]*?)\s*(?:<\/proposed_plan>|&lt;\/proposed_plan&gt;)/gi;
    // Промпт требует «полная замена, не патч». Если модель выдала несколько
    // <proposed_plan> блоков (черновик + финал, ревизия) — рендерим в
    // карточку только последний, остальные выкидываем, чтобы не плодить
    // лишние Build-кнопки.
    let text = String(raw || "");
    const allMatches = [];
    text.replace(re, (...args) => {
      allMatches.push(args);
      return "";
    });
    // Recovery: обрезанный <proposed_plan> без закрывающего тега (модель
    // упёрлась в max_tokens посередине плана). Regex выше не матчит —
    // достраиваем: если есть открывающий тег, но нет закрывающего, берём
    // остаток текста как тело плана, чтобы карточка всё-таки отрисовалась.
    // с кнопкой Build (пользователь увидит, что план обрезан, и сможет
    // попросить продолжение).
    if (!allMatches.length) {
      const openRe =
        /(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*([\s\S]*)/i;
      const openMatch = openRe.exec(text);
      if (openMatch) {
        allMatches.push(openMatch);
      }
    }
    const lastIdx = allMatches.length - 1;
    let matchIdx = 0;
    let out = text;
    if (allMatches.length) {
      let usedRecovery = !re.test(text);
      if (usedRecovery) {
        // Обрезанный случай: заменяем вручную, regex не матчит.
        const body = allMatches[0][1];
        const id = blocks.length;
        blocks.push(renderProposedPlanCard(String(body || "").trim()));
        out = text.replace(
          /(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*([\s\S]*)/i,
          `\n\n\u0002PLAN${id}\u0002\n\n`
        );
      } else {
        out = text.replace(re, (_full, body) => {
          const isLast = matchIdx === lastIdx;
          matchIdx += 1;
          if (!isLast) {
            return "";
          }
          const id = blocks.length;
          blocks.push(renderProposedPlanCard(body.trim()));
          return `\n\n\u0002PLAN${id}\u0002\n\n`;
        });
      }
    }
    return { text: out, blocks };
  }

  function restoreProposedPlanBlocks(html, blocks) {
    if (!blocks.length) {
      return html;
    }
    return String(html || "").replace(/\u0002PLAN(\d+)\u0002/g, (_, id) => {
      return blocks[Number(id)] || "";
    });
  }

  const PLAN_SECTION_NEXT_RE =
    /^(Цель|Goal|Шаги|Steps|Затрагиваемые(?:\s+файлы)?|Affected(?:\s+files)?|Риски|Risks|Acceptance)\b/i;

  /** Drop blank paragraphs / lone <br> that inflate vertical gaps. */
  function stripEmptyPlanBlocks(root) {
    if (!(root instanceof HTMLElement)) {
      return;
    }
    root.querySelectorAll(".md-p").forEach((el) => {
      if (!(el instanceof HTMLElement)) {
        return;
      }
      const text = String(el.textContent || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        return;
      }
      el.remove();
    });
    root.querySelectorAll("br").forEach((br) => {
      const prev = br.previousSibling;
      const next = br.nextSibling;
      const onlyPad =
        (!prev || (prev.nodeType === 3 && !String(prev.textContent || "").trim())) &&
        (!next || (next.nodeType === 3 && !String(next.textContent || "").trim()));
      if (onlyPad && br.parentElement && br.parentElement.children.length === 1) {
        br.parentElement.remove();
        return;
      }
      if (
        prev &&
        prev.nodeName === "BR" &&
        br.parentElement &&
        br.parentElement.classList.contains("md-p")
      ) {
        br.remove();
      }
    });
  }

  /**
   * After marked.parse: wrap optional Implementation section.
   * Keeps preview-like code blocks (no chat chrome bars).
   */
  function enhancePlanBodyHtml(html) {
    const raw = String(html || "");
    if (!raw.trim()) {
      return raw;
    }
    const root = document.createElement("div");
    root.innerHTML = raw;
    stripEmptyPlanBlocks(root);

    const kids = Array.from(root.children);
    let implStart = -1;
    for (let i = 0; i < kids.length; i++) {
      const label = String(kids[i].textContent || "")
        .trim()
        .replace(/^#+\s*/, "");
      if (/^Implementation\b/i.test(label)) {
        implStart = i;
        break;
      }
    }
    if (implStart >= 0) {
      let implEnd = kids.length;
      for (let j = implStart + 1; j < kids.length; j++) {
        const label = String(kids[j].textContent || "")
          .trim()
          .replace(/^#+\s*/, "");
        if (PLAN_SECTION_NEXT_RE.test(label) && label.length < 96) {
          implEnd = j;
          break;
        }
      }
      const wrap = document.createElement("div");
      wrap.className = "proposed-plan-impl";
      const heading = document.createElement("div");
      heading.className = "proposed-plan-impl-label";
      heading.innerHTML =
        `<span class="material-symbols-outlined" aria-hidden="true">code</span>` +
        `<span>${escapeHtml(t("proposedPlanCodeSection"))}</span>`;
      const body = document.createElement("div");
      body.className = "proposed-plan-impl-body";
      const anchor = kids[implStart];
      root.insertBefore(wrap, anchor);
      wrap.appendChild(heading);
      wrap.appendChild(body);
      for (let k = implStart; k < implEnd; k++) {
        body.appendChild(kids[k]);
      }
    }

    return root.innerHTML;
  }

  /**
   * Markdown for plan card body — same GFM pipeline as chat / Preview
   * (no nested proposed_plan extraction).
   */
  function renderPlanBodyHtml(planBody) {
    const text = String(planBody || "");
    if (!text) {
      return "";
    }
    const extracted = replaceCitationFences(text);
    const api = getMarkedApi();
    if (ensureMarkdownRenderer() && api) {
      try {
        const html = api.parse(extracted.text, { async: false });
        return enhancePlanBodyHtml(
          restoreCitationFences(html, extracted.blocks)
        );
      } catch {
        // fall through
      }
    }
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br />");
  }

  function renderProposedPlanCard(planBody) {
    const raw = stripPlanImplementWrapper(planBody);
    const title = escapeHtml(t("proposedPlanTitle"));
    const openTab = escapeHtml(t("proposedPlanOpenTab"));
    const expand = escapeHtml(t("proposedPlanExpand"));
    return `<div class="proposed-plan-card is-collapsed" data-plan-raw="${escapeHtml(raw)}">`
      + `<div class="proposed-plan-head">`
      + `<button class="proposed-plan-toggle" type="button" data-plan-action="toggle" aria-expanded="false" title="${expand}">`
      + `<span class="material-symbols-outlined proposed-plan-chevron" aria-hidden="true">expand_more</span>`
      + `<span class="proposed-plan-title">${title}</span>`
      + `</button>`
      + `<div class="proposed-plan-actions">`
      + `<button class="proposed-plan-open-tab" type="button" data-plan-action="open-tab" title="${openTab}">`
      + `<span class="material-symbols-outlined" aria-hidden="true">preview</span>`
      + `<span>${openTab}</span>`
      + `</button>`
      + `</div>`
      + `</div>`
      + `<div class="proposed-plan-body" hidden>${renderPlanBodyHtml(raw)}</div>`
      + `</div>`;
  }

  function setProposedPlanCollapsed(card, collapsed) {
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const body = card.querySelector(".proposed-plan-body");
    const toggle = card.querySelector("[data-plan-action='toggle']");
    if (!body || !(toggle instanceof HTMLButtonElement)) {
      return;
    }
    card.classList.toggle("is-collapsed", collapsed);
    body.hidden = collapsed;
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.title = collapsed
      ? t("proposedPlanExpand")
      : t("proposedPlanCollapse");
  }

  function openProposedPlanInTab(card) {
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const raw = stripPlanImplementWrapper(card.dataset.planRaw || "");
    if (!raw) {
      return;
    }
    const key = raw.replace(/\s+/g, " ").trim();
    lastOpenedPlanKey = key;
    // Explicit card action: markdown preview beside the editor.
    host.postMessage({
      type: "openPlanMarkdown",
      text: raw,
      reveal: "preview",
    });
  }

  function getMarkedApi() {
    if (typeof marked === "undefined") {
      return null;
    }
    // UMD: window.marked = { marked, parse, Renderer, use, ... }
    if (marked && typeof marked.parse === "function" && marked.Renderer) {
      return marked;
    }
    if (marked && typeof marked.marked === "function") {
      return {
        parse: marked.marked.parse || marked.marked,
        parseInline: marked.marked.parseInline || marked.parseInline,
        Renderer: marked.Renderer || marked.marked.Renderer,
        use: marked.use || marked.marked.use,
      };
    }
    return null;
  }

  const CODE_KEYWORDS = new Set([
    "as",
    "async",
    "await",
    "any",
    "boolean",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "def",
    "default",
    "delete",
    "do",
    "elif",
    "else",
    "enum",
    "export",
    "extends",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "interface",
    "keyof",
    "let",
    "new",
    "never",
    "number",
    "of",
    "private",
    "protected",
    "public",
    "return",
    "static",
    "string",
    "switch",
    "throw",
    "try",
    "type",
    "typeof",
    "unknown",
    "var",
    "void",
    "while",
    "with",
    "yield",
  ]);
  const CODE_LITERALS = new Set([
    "false",
    "None",
    "null",
    "super",
    "this",
    "true",
    "undefined",
  ]);

  function inferCodeLanguage(meta) {
    const explicit = String(meta?.language || "").trim().toLowerCase();
    if (explicit) {
      return explicit;
    }
    const path = String(meta?.path || "").split(/[?#]/)[0];
    const ext = path.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase() || "";
    const aliases = {
      cjs: "javascript",
      htm: "html",
      js: "javascript",
      jsonc: "json",
      jsx: "javascript",
      mjs: "javascript",
      py: "python",
      rb: "ruby",
      sh: "shell",
      ts: "typescript",
      tsx: "typescript",
      yml: "yaml",
    };
    return aliases[ext] || ext;
  }

  function codeTokenClass(token, language, precedingText, followingText) {
    if (
      token.startsWith("//") ||
      token.startsWith("/*") ||
      (language === "python" && token.startsWith("#"))
    ) {
      return "comment";
    }
    if (/^['"`]/.test(token)) {
      return "string";
    }
    if (/^\d/.test(token)) {
      return "number";
    }
    if (CODE_KEYWORDS.has(token)) {
      return "keyword";
    }
    if (CODE_LITERALS.has(token)) {
      return "literal";
    }
    if (/^[A-Z][A-Za-z0-9_$]*$/.test(token)) {
      return "type";
    }
    if (/\.\s*$/.test(precedingText)) {
      return "property";
    }
    if (/^\s*\(/.test(followingText)) {
      return "function";
    }
    return "variable";
  }

  function highlightCode(text, language) {
    const source = String(text || "");
    const commentPattern =
      language === "python" || language === "ruby" || language === "shell"
        ? "#[^\\n]*"
        : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
    const tokenRe = new RegExp(
      "(" +
        commentPattern +
        "|'(?:\\\\.|[^'\\\\])*'|\"(?:\\\\.|[^\"\\\\])*\"|`(?:\\\\.|[^`\\\\])*`|\\b\\d+(?:\\.\\d+)?\\b|\\b[A-Za-z_$][\\w$]*\\b)",
      "g"
    );
    let html = "";
    let cursor = 0;
    let match;
    while ((match = tokenRe.exec(source))) {
      html += escapeHtml(source.slice(cursor, match.index));
      const token = match[0];
      const kind = codeTokenClass(
        token,
        language,
        source.slice(0, match.index),
        source.slice(match.index + token.length)
      );
      html += kind
        ? `<span class="syntax-${kind}">${escapeHtml(token)}</span>`
        : escapeHtml(token);
      cursor = match.index + token.length;
    }
    return html + escapeHtml(source.slice(cursor));
  }

  function renderCodeBlockHtml(text, langRaw) {
    const inner = String(text || "").replace(/\n$/, "");
    if (isFilePath(inner.trim()) && !inner.includes("\n")) {
      return fileLinkHtml(inner.trim());
    }
    const meta = parseCodeFenceMeta(langRaw);
    const language = inferCodeLanguage(meta);
    const lines = inner.split("\n");
    const showLines =
      meta.startLine > 0 &&
      Number.isFinite(meta.startLine) &&
      lines.length > 0;
    const codeHtml = showLines
      ? lines
          .map((line, i) => {
            const n = meta.startLine + i;
            return (
              `<span class="md-line">` +
              `<span class="md-ln" aria-hidden="true">${n}</span>` +
              `<span class="md-line-text">${highlightCode(line, language)}</span>` +
              `</span>`
            );
          })
          .join("\n")
      : highlightCode(inner, language);

    let metaHtml = "";
    if (meta.path || showLines) {
      const fileType = selectionFileType({
        path: meta.path,
        language: meta.language,
      });
      const fileTypePart = meta.path
        ? `<span class="selection-file-icon md-file-icon selection-file-icon-${fileType.className}" aria-hidden="true">${escapeHtml(fileType.label)}</span>`
        : "";
      const pathPart = meta.path
        ? isFilePath(meta.path) || meta.path.includes("/")
          ? fileLinkHtml(meta.path)
          : `<span class="md-pre-path">${escapeHtml(meta.path)}</span>`
        : "";
      const linesPart = showLines
        ? `<span class="md-pre-lines">${
            meta.startLine === meta.endLine
              ? `line ${meta.startLine}`
              : `lines ${meta.startLine}–${meta.endLine}`
          }</span>`
        : "";
      metaHtml =
        `<div class="md-pre-meta${showLines ? " md-pre-toggle" : ""}"` +
        (showLines
          ? ` role="button" tabindex="0" aria-expanded="false" aria-label="${
              UI_LANG === "ru" ? "Показать или скрыть код" : "Show or hide code"
            }">`
          : `>`) +
        `<span class="md-pre-meta-main">` +
        fileTypePart +
        pathPart +
        (pathPart && linesPart ? `<span class="md-pre-meta-sep">·</span>` : "") +
        linesPart +
        `</span>` +
        (showLines
          ? `<span class="material-symbols-outlined md-pre-chevron" aria-hidden="true">expand_more</span>`
          : "") +
        `</div>`;
    }

    return (
      `<div class="md-pre-wrap${showLines ? " has-lines is-collapsible is-collapsed" : ""}">` +
      metaHtml +
      `<pre class="md-pre"><code>${codeHtml}</code></pre>` +
      `</div>\n`
    );
  }

  function toggleCodeBlock(toggle) {
    const wrap = toggle?.closest(".md-pre-wrap.is-collapsible");
    if (!wrap) {
      return;
    }
    const collapsed = wrap.classList.toggle("is-collapsed");
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  let markdownReady = false;

  function ensureMarkdownRenderer() {
    const api = getMarkedApi();
    if (markdownReady) {
      return Boolean(api);
    }
    if (!api || !api.Renderer) {
      return false;
    }
    markdownReady = true;

    const renderer = new api.Renderer();

    renderer.code = function (token) {
      return renderCodeBlockHtml(token.text, token.lang);
    };

    renderer.codespan = function ({ text }) {
      const value = String(text || "");
      if (isFilePath(value)) {
        return fileLinkHtml(value);
      }
      return `<code class="md-code">${escapeHtml(value)}</code>`;
    };

    renderer.heading = function ({ tokens, depth }) {
      const level = Math.min(3, Math.max(1, depth || 1));
      return `<div class="md-h md-h${level}">${this.parser.parseInline(
        tokens
      )}</div>\n`;
    };

    renderer.paragraph = function ({ tokens }) {
      return `<div class="md-p">${this.parser.parseInline(tokens)}</div>\n`;
    };

    renderer.blockquote = function ({ tokens }) {
      return `<blockquote class="md-quote">${this.parser.parse(
        tokens
      )}</blockquote>\n`;
    };

    renderer.list = function ({ items, ordered, start }) {
      const tag = ordered ? "ol" : "ul";
      const startAttr = ordered && start !== 1 ? ` start="${start}"` : "";
      const body = items.map((item) => this.listitem(item)).join("");
      return `<${tag} class="md-list md-${tag}"${startAttr}>${body}</${tag}>\n`;
    };

    renderer.listitem = function (item) {
      let body = "";
      if (item.task) {
        const checked = item.checked ? " checked" : "";
        body += `<input class="md-task" type="checkbox" disabled${checked} /> `;
      }
      body += this.parser.parse(item.tokens, !!item.loose);
      return `<li class="md-li">${body}</li>\n`;
    };

    renderer.checkbox = function () {
      return "";
    };

    renderer.strong = function ({ tokens }) {
      return `<strong class="md-strong">${this.parser.parseInline(
        tokens
      )}</strong>`;
    };

    renderer.em = function ({ tokens }) {
      return `<em class="md-em">${this.parser.parseInline(tokens)}</em>`;
    };

    renderer.del = function ({ tokens }) {
      return `<del class="md-del">${this.parser.parseInline(tokens)}</del>`;
    };

    renderer.link = function ({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      const safeHref = String(href || "");
      if (!/^https?:\/\//i.test(safeHref)) {
        if (isFilePath(safeHref)) {
          return fileLinkHtml(safeHref);
        }
        return label;
      }
      const t = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a class="md-link" href="${escapeHtml(
        safeHref
      )}" data-href="${escapeHtml(safeHref)}"${t}>${label}</a>`;
    };

    renderer.image = function ({ text, href }) {
      return escapeHtml(text || href || "");
    };

    renderer.html = function ({ text }) {
      return escapeHtml(text || "");
    };

    renderer.hr = function () {
      return '<hr class="md-hr" />\n';
    };

    renderer.br = function () {
      return "<br />";
    };

    renderer.table = function (token) {
      let header = "";
      for (const cell of token.header) {
        header += this.tablecell(cell);
      }
      let body = "";
      for (const row of token.rows) {
        let cells = "";
        for (const cell of row) {
          cells += this.tablecell(cell);
        }
        body += this.tablerow({ text: cells });
      }
      return (
        `<div class="md-table-wrap"><table class="md-table"><thead>${this.tablerow(
          { text: header }
        )}</thead><tbody>${body}</tbody></table></div>\n`
      );
    };

    renderer.tablerow = function ({ text }) {
      return `<tr>${text}</tr>\n`;
    };

    renderer.tablecell = function (cell) {
      const tag = cell.header ? "th" : "td";
      const align = cell.align ? ` style="text-align:${cell.align}"` : "";
      return `<${tag} class="md-td"${align}>${this.parser.parseInline(
        cell.tokens
      )}</${tag}>`;
    };

    renderer.text = function (token) {
      if (token.tokens && token.tokens.length) {
        return this.parser.parseInline(token.tokens);
      }
      return linkifyPlainText(String(token.text || ""), !!token.escaped);
    };

    api.use({
      renderer,
      gfm: true,
      breaks: true,
      pedantic: false,
    });
    return true;
  }

  /** Markdown (GFM): таблицы, списки, заголовки, код, ссылки, жирный/курсив и т.д. */
  function renderInlineMarkdown(text, opts) {
    const raw = String(text || "");
    if (!raw) {
      return "";
    }
    const extracted = replaceCitationFences(raw, Boolean(opts && opts.userChrome));
    const plans = replaceProposedPlanBlocks(extracted.text);
    const api = getMarkedApi();
    if (ensureMarkdownRenderer() && api) {
      try {
        const html = api.parse(plans.text, { async: false });
        return restoreProposedPlanBlocks(
          restoreCitationFences(html, extracted.blocks),
          plans.blocks
        );
      } catch {
        // fallback below
      }
    }
    if (extracted.blocks.length || plans.blocks.length) {
      return restoreProposedPlanBlocks(
        restoreCitationFences(
          `<div class="md-p">${linkifyPlainText(plans.text, false).replace(
            /\n/g,
            "<br />"
          )}</div>`,
          extracted.blocks
        ),
        plans.blocks
      );
    }
    return `<div class="md-p">${linkifyPlainText(raw, false).replace(
      /\n/g,
      "<br />"
    )}</div>`;
  }

  /** Однострочный Markdown для короткого описания агента. */
  function renderPreviewMarkdown(text) {
    const raw = String(text || "");
    if (!raw) {
      return "";
    }
    const api = getMarkedApi();
    if (ensureMarkdownRenderer() && api && typeof api.parseInline === "function") {
      try {
        return api.parseInline(raw, { async: false });
      } catch {
        // fallback below
      }
    }
    return escapeHtml(raw);
  }
