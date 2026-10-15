
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
        blocks.push(
          renderProposedPlanCard(String(body || "").trim(), { partial: true })
        );
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
    /^(Цель|Goal|Контекст|Context|Шаги|Steps|Затрагиваемые(?:\s+файлы)?|Затронутые(?:\s+файлы)?|Affected(?:\s+files)?|Проверка|Verification|Риски|Risks|Вне\s+рамок|Out\s+of\s+scope|Acceptance)/i;

  /**
   * Plan template sections (Harbor Plan-mode rules, src/planImplement.ts).
   * Required ones feed the «incomplete plan» chip on the card.
   * No `\b`: JS word boundaries are ASCII-only and never match after «Цель».
   */
  const PLAN_SECTION_DEFS = [
    { key: "goal", re: /^(?:Цель|Goal)(?![\p{L}\p{N}])/iu, required: true },
    { key: "context", re: /^(?:Контекст|Context)(?![\p{L}\p{N}])/iu },
    {
      key: "steps",
      re: /^(?:Шаги|Steps|План\s+работ|Implementation\s+steps)(?![\p{L}\p{N}])/iu,
      required: true,
    },
    {
      key: "files",
      re: /^(?:Затронутые|Затрагиваемые|Affected|Изменяемые\s+файлы|Files)(?![\p{L}\p{N}])/iu,
      required: true,
    },
    {
      key: "verify",
      re: /^(?:Проверка|Verification|Тестирование|Testing|Acceptance)(?![\p{L}\p{N}])/iu,
      required: true,
    },
    { key: "risks", re: /^(?:Риски|Risks)(?![\p{L}\p{N}])/iu },
    { key: "outOfScope", re: /^(?:Вне\s+рамок|Out\s+of\s+scope)(?![\p{L}\p{N}])/iu },
  ];

  /**
   * Header facts for the plan card: goal line, step / file counts and missing
   * required sections. Self-contained (no outer helpers) — tests eval it.
   */
  function summarizePlanMarkdown(markdown) {
    const lines = String(markdown || "").split(/\r?\n/);
    const sections = {};
    let current = "";
    let goalInline = "";
    const plain = (value) =>
      String(value || "")
        .replace(/[*_`]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
    for (const line of lines) {
      const heading =
        /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line) ||
        /^\s{0,3}\*\*([^*]+?)\*\*\s*:?\s*(.*)$/.exec(line);
      if (heading) {
        const label = plain(heading[1]).replace(/:\s*$/, "");
        const def = PLAN_SECTION_DEFS.find((d) => d.re.test(label));
        if (def) {
          current = def.key;
          sections[current] = sections[current] || [];
          // «## Цель: текст» / «**Цель:** текст» — goal on the heading line.
          const rest =
            plain(heading[2] || "") ||
            plain(label.replace(def.re, "").replace(/^\s*[:—–-]\s*/, ""));
          if (current === "goal" && rest) {
            goalInline = rest;
          }
          continue;
        }
        if (/^\s{0,3}#{1,6}\s/.test(line)) {
          current = "";
          continue;
        }
      }
      if (current) {
        sections[current].push(line);
      }
    }
    const topNumbered = (list) =>
      list.filter((l) => /^\s{0,3}\d+[.)]\s+\S/.test(l)).length;
    // Nested items under «1.» are indented 3 spaces — top level is ≤ 1.
    const topItems = (list) =>
      list.filter((l) => /^\s?(?:\d+[.)]|[-*+•])\s+\S/.test(l)).length;
    let goal = goalInline;
    if (!goal && sections.goal) {
      const first = sections.goal.find((l) => l.trim());
      goal = plain(first ? first.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "") : "");
    }
    let steps = sections.steps
      ? topNumbered(sections.steps) || topItems(sections.steps)
      : 0;
    if (!sections.steps) {
      steps = topNumbered(lines);
    }
    const files = sections.files ? topItems(sections.files) : 0;
    const missing = PLAN_SECTION_DEFS.filter(
      (d) =>
        d.required &&
        !(sections[d.key] && sections[d.key].some((l) => l.trim())) &&
        !(d.key === "goal" && goal) &&
        !(d.key === "steps" && steps > 0)
    ).map((d) => d.key);
    return { goal, steps, files, missing };
  }
  // end summarizePlanMarkdown

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

    decoratePlanSections(root);
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

  function planSectionLabelText(el) {
    return String((el && el.textContent) || "")
      .trim()
      .replace(/^#+\s*/, "")
      .replace(/[*_`:]+/g, "")
      .trim();
  }

  /** First list right after a section heading (until the next heading). */
  function planSectionList(kids, headingRe) {
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i];
      const isHeading =
        /^H[1-6]$/.test(el.tagName) || el.classList.contains("md-h");
      const label = planSectionLabelText(el);
      if (!isHeading && !(el.querySelector("strong") && label.length < 48)) {
        continue;
      }
      if (!headingRe.test(label)) {
        continue;
      }
      for (let j = i + 1; j < kids.length; j++) {
        const next = kids[j];
        if (/^H[1-6]$/.test(next.tagName) || next.classList.contains("md-h")) {
          break;
        }
        if (next.tagName === "OL" || next.tagName === "UL") {
          return next;
        }
      }
    }
    return null;
  }

  /** Icon for an «Affected files» row: create / delete / modify. */
  function planFileActionIcon(text) {
    const value = String(text || "").toLowerCase();
    if (/(?:созда|нов(?:ый|ая|ое)|добав|\bcreate|\bnew\b|\badd)/.test(value)) {
      return { icon: "add_circle", cls: "is-create" };
    }
    if (/(?:удал|\bdelete|\bremove)/.test(value)) {
      return { icon: "remove_circle", cls: "is-delete" };
    }
    return { icon: "edit", cls: "is-modify" };
  }

  const PLAN_PATH_LINE_RE =
    /^(.+?\.[A-Za-z0-9]+|(?:[\w.@-]+\/)+[\w.@-]+)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/;

  /** `src/a/b.ts:53-71` → compact chip «b.ts:53–71» (full path in title). */
  function planFileChipHtml(path, line, lineEnd) {
    const full = String(path || "");
    const lineLabel = line ? `:${line}${lineEnd ? `–${lineEnd}` : ""}` : "";
    const title = escapeHtml(full + lineLabel);
    return `<a class="md-file plan-file-chip" href="#" data-path="${escapeHtml(full)}"`
      + (line ? ` data-line="${escapeHtml(line)}"` : "")
      + ` title="${title}">${escapeHtml(pathBasename(full))}`
      + (lineLabel ? `<em>${escapeHtml(lineLabel)}</em>` : "")
      + `</a>`;
  }

  /** Inline-code paths (with optional :line) and plain file links → chips. */
  function chipifyPlanPaths(root) {
    root.querySelectorAll("code.md-code").forEach((code) => {
      const m = PLAN_PATH_LINE_RE.exec(String(code.textContent || "").trim());
      if (!m || !isFilePath(m[1])) {
        return;
      }
      const tmp = document.createElement("span");
      tmp.innerHTML = planFileChipHtml(m[1], m[2], m[3]);
      code.replaceWith(tmp.firstChild);
    });
    root.querySelectorAll("a.md-file:not(.plan-file-chip)").forEach((a) => {
      a.classList.add("plan-file-chip");
    });
  }

  function planHeadingEl(el) {
    if (!(el instanceof HTMLElement)) {
      return false;
    }
    if (/^H[1-6]$/.test(el.tagName) || el.classList.contains("md-h")) {
      return true;
    }
    // «**Шаги:**» on its own line — bold-label heading.
    return (
      el.classList.contains("md-p") &&
      el.children.length === 1 &&
      el.firstElementChild.tagName === "STRONG" &&
      planSectionLabelText(el).length < 48 &&
      planSectionLabelText(el) === planSectionLabelText(el.firstElementChild)
    );
  }

  function planSectionKey(label) {
    const def = PLAN_SECTION_DEFS.find((d) => d.re.test(label));
    return def ? def.key : "";
  }

  /** Affected files list → chips grouped by folder, with action icons. */
  function groupPlanFiles(list) {
    const groups = new Map();
    const order = [];
    Array.from(list.children).forEach((li) => {
      if (li.tagName !== "LI") {
        return;
      }
      const link = li.querySelector("a.md-file");
      const path = link ? String(link.getAttribute("data-path") || "") : "";
      if (!path) {
        return;
      }
      const slash = path.lastIndexOf("/");
      const folder = slash > 0 ? path.slice(0, slash + 1) : "";
      if (!groups.has(folder)) {
        groups.set(folder, []);
        order.push(folder);
      }
      groups.get(folder).push({ path, action: planFileActionIcon(li.textContent) });
    });
    if (!order.length) {
      return null;
    }
    const wrap = document.createElement("div");
    wrap.className = "proposed-plan-files";
    order.forEach((folder) => {
      const group = document.createElement("div");
      group.className = "proposed-plan-files-group";
      if (folder) {
        const label = document.createElement("div");
        label.className = "proposed-plan-files-folder";
        // Long folders keep their tail: «…/initial-briefing-knowledge-check/lib/».
        const parts = folder.split("/").filter(Boolean);
        label.textContent =
          parts.length > 3 ? `…/${parts.slice(-3).join("/")}/` : folder;
        label.title = folder;
        group.appendChild(label);
      }
      const row = document.createElement("div");
      row.className = "proposed-plan-files-row";
      groups.get(folder).forEach(({ path, action }) => {
        const tmp = document.createElement("span");
        tmp.innerHTML = planFileChipHtml(path);
        const chip = tmp.firstChild;
        chip.classList.add(action.cls);
        const icon = document.createElement("span");
        icon.className = "material-symbols-outlined proposed-plan-file-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = action.icon;
        chip.insertBefore(icon, chip.firstChild);
        row.appendChild(chip);
      });
      group.appendChild(row);
      wrap.appendChild(group);
    });
    return wrap;
  }

  /**
   * Plan body → foldable sections (heading + content). Goal is shown in the
   * card header, Context is folded by default (reference for the agent),
   * Steps become a numbered timeline, Affected files — chips by folder, and a
   * missing required section gets an inline «Complete» placeholder.
   */
  function decoratePlanSections(root) {
    chipifyPlanPaths(root);
    const kids = Array.from(root.children);
    const sections = [];
    let current = null;
    kids.forEach((el) => {
      if (planHeadingEl(el)) {
        const label = planSectionLabelText(el);
        current = { label, key: planSectionKey(label), head: el, nodes: [] };
        sections.push(current);
        return;
      }
      if (!current) {
        current = { label: "", key: "intro", head: null, nodes: [] };
        sections.push(current);
      }
      current.nodes.push(el);
    });
    root.replaceChildren();
    const seen = new Set();
    sections.forEach((sec) => {
      seen.add(sec.key);
      const box = document.createElement("section");
      box.className = "proposed-plan-sec";
      if (sec.key) {
        box.dataset.sec = sec.key;
      }
      const body = document.createElement("div");
      body.className = "proposed-plan-sec-body";
      sec.nodes.forEach((node) => body.appendChild(node));
      if (sec.key === "steps") {
        const ol = body.querySelector("ol");
        if (ol) {
          ol.classList.add("proposed-plan-steps");
          // «**Title** — gist»: the title becomes the step heading, drop
          // the leading dash of the gist.
          Array.from(ol.children).forEach((li) => {
            const host =
              li.firstElementChild && li.firstElementChild.classList.contains("md-p")
                ? li.firstElementChild
                : li;
            const strong = host.firstChild;
            if (!strong || strong.nodeName !== "STRONG") {
              return;
            }
            const next = strong.nextSibling;
            if (next && next.nodeType === 3) {
              next.textContent = next.textContent.replace(/^\s*(?:[—–-]|:)\s*/, "");
            }
          });
        }
      }
      if (sec.key === "files") {
        const list = body.querySelector("ul, ol");
        const grouped = list ? groupPlanFiles(list) : null;
        if (grouped) {
          list.replaceWith(grouped);
        }
      }
      if (sec.head) {
        const head = document.createElement("button");
        head.type = "button";
        head.className = "proposed-plan-sec-head";
        head.setAttribute("data-plan-action", "fold");
        let count = "";
        if (sec.key === "context") {
          const n = body.querySelectorAll(".plan-file-chip").length;
          count = n ? t("proposedPlanContextCount", n) : "";
          box.classList.add("is-folded");
        }
        head.innerHTML =
          `<span class="material-symbols-outlined" aria-hidden="true">expand_more</span>`
          + `<span>${escapeHtml(sec.label)}</span>`
          + (count ? `<span class="proposed-plan-sec-count">· ${escapeHtml(count)}</span>` : "");
        box.appendChild(head);
      }
      box.appendChild(body);
      root.appendChild(box);
    });
    ["verify"].forEach((key) => {
      if (seen.has(key) || !sections.some((sec) => sec.head)) {
        return;
      }
      const box = document.createElement("section");
      box.className = "proposed-plan-sec is-missing";
      box.dataset.sec = key;
      box.innerHTML =
        `<div class="proposed-plan-sec-head is-static"><span class="material-symbols-outlined" aria-hidden="true">expand_more</span><span>${escapeHtml(t(`proposedPlanSection_${key}`))}</span></div>`
        + `<div class="proposed-plan-missing">`
        + `<span class="material-symbols-outlined" aria-hidden="true">warning</span>`
        + `<span class="proposed-plan-missing-text">${escapeHtml(t(`proposedPlanMissingText_${key}`))}</span>`
        + `<button type="button" class="proposed-plan-missing-btn" data-plan-action="complete">${escapeHtml(t("proposedPlanComplete"))}</button>`
        + `</div>`;
      root.appendChild(box);
    });
  }

  function planCountLabel(n, kind) {
    return t(kind === "files" ? "proposedPlanFilesCount" : "proposedPlanStepsCount", n);
  }

  function renderProposedPlanCard(planBody, opts) {
    const raw = stripPlanImplementWrapper(planBody);
    const partial = Boolean(opts && opts.partial);
    const summary = summarizePlanMarkdown(raw);
    const title = escapeHtml(t("proposedPlanTitle"));
    const openTab = escapeHtml(t("proposedPlanOpenTab"));
    const collapse = escapeHtml(t("proposedPlanCollapse"));
    const build = escapeHtml(t("proposedPlanBuild"));
    const copy = escapeHtml(t("proposedPlanCopy"));
    const icon = (name) =>
      `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
    const chips = [];
    if (summary.steps > 0) {
      chips.push(
        `<span class="proposed-plan-chip">${icon("format_list_numbered")}${escapeHtml(planCountLabel(summary.steps, "steps"))}</span>`
      );
    }
    if (summary.files > 0) {
      chips.push(
        `<span class="proposed-plan-chip">${icon("description")}${escapeHtml(planCountLabel(summary.files, "files"))}</span>`
      );
    }
    if (summary.missing.length) {
      const names = summary.missing
        .map((key) => t(`proposedPlanSection_${key}`))
        .join(", ");
      chips.push(
        `<span class="proposed-plan-chip is-warn" title="${escapeHtml(t("proposedPlanIncompleteHint"))}">${icon("warning")}${escapeHtml(t("proposedPlanMissing", names))}</span>`
      );
    }
    // Visible only once the stream ended without </proposed_plan> (sync).
    chips.push(
      `<span class="proposed-plan-chip is-warn proposed-plan-truncated-chip">${icon("content_cut")}${escapeHtml(t("proposedPlanTruncated"))}</span>`
    );
    chips.push(
      `<span class="proposed-plan-chip is-info proposed-plan-edited-chip" title="${escapeHtml(t("proposedPlanEditedHint"))}">${icon("edit_note")}${escapeHtml(t("proposedPlanEdited"))}</span>`
    );
    const status = (state, name, label) =>
      `<span class="proposed-plan-pill proposed-plan-pill-${state}">${name ? icon(name) : ""}${escapeHtml(label)}</span>`;
    return `<div class="proposed-plan-card${partial ? " is-partial" : ""}${summary.goal ? " has-goal" : ""}" data-plan-raw="${escapeHtml(raw)}" data-plan-state="draft">`
      + `<div class="proposed-plan-head">`
      + `<button class="proposed-plan-toggle" type="button" data-plan-action="toggle" aria-expanded="true" title="${collapse}">`
      + `<span class="material-symbols-outlined proposed-plan-title-icon" aria-hidden="true">checklist</span>`
      + `<span class="proposed-plan-title">${title}</span>`
      + `</button>`
      + status("ready", "", t("proposedPlanStatusReady"))
      + status("streaming", "", t("proposedPlanStatusStreaming"))
      + status("done", "check_circle", t("proposedPlanStatusDone"))
      + status("superseded", "history", t("proposedPlanStatusSuperseded"))
      + `<span class="proposed-plan-head-spacer"></span>`
      + `<div class="proposed-plan-actions">`
      + `<button class="proposed-plan-icon-btn" type="button" data-plan-action="copy" title="${copy}" aria-label="${copy}">${icon("content_copy")}</button>`
      + `<button class="proposed-plan-icon-btn" type="button" data-plan-action="open-tab" title="${openTab}" aria-label="${openTab}">${icon("preview")}</button>`
      + `<button class="proposed-plan-icon-btn proposed-plan-chevron-btn" type="button" data-plan-action="toggle" title="${collapse}" aria-label="${collapse}"><span class="material-symbols-outlined proposed-plan-chevron" aria-hidden="true">expand_less</span></button>`
      + `</div>`
      + `</div>`
      + (summary.goal
        ? `<div class="proposed-plan-goal" title="${escapeHtml(summary.goal)}">${escapeHtml(summary.goal)}</div>`
        : "")
      + `<div class="proposed-plan-meta">${chips.join("")}</div>`
      + `<div class="proposed-plan-body">${renderPlanBodyHtml(raw)}</div>`
      + `<div class="proposed-plan-foot">`
      + `<span class="proposed-plan-foot-hint">${escapeHtml(t("proposedPlanFootHint"))}</span>`
      + `<button class="proposed-plan-secondary-btn proposed-plan-continue" type="button" data-plan-action="continue" title="${escapeHtml(t("proposedPlanContinueHint"))}">${icon("play_arrow")}<span>${escapeHtml(t("proposedPlanContinue"))}</span></button>`
      + `<button class="proposed-plan-secondary-btn proposed-plan-edit" type="button" data-plan-action="edit" title="${escapeHtml(t("proposedPlanEditHint"))}">${icon("edit")}<span>${escapeHtml(t("proposedPlanEditBtn"))}</span></button>`
      + `<button class="proposed-plan-build" type="button" data-plan-action="build" title="${build}">${icon("construction")}<span>${build}</span></button>`
      + `</div>`
      + `</div>`;
  }

  function setProposedPlanCollapsed(card, collapsed) {
    if (!(card instanceof HTMLElement)) {
      return;
    }
    const body = card.querySelector(".proposed-plan-body");
    if (!body) {
      return;
    }
    card.classList.toggle("is-collapsed", collapsed);
    body.hidden = collapsed;
    card.querySelectorAll("[data-plan-action='toggle']").forEach((toggle) => {
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.title = collapsed
        ? t("proposedPlanExpand")
        : t("proposedPlanCollapse");
    });
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

    const wrapLabel = escapeHtml(t("codeWrap"));
    const copyLabel = escapeHtml(t("codeCopy"));
    const toolsHtml =
      `<div class="md-pre-tools">` +
      `<button type="button" class="md-pre-tool" data-code-action="wrap" aria-pressed="false" title="${wrapLabel}" aria-label="${wrapLabel}">` +
      `<span class="material-symbols-outlined" aria-hidden="true">wrap_text</span>` +
      `</button>` +
      `<button type="button" class="md-pre-tool" data-code-action="copy" title="${copyLabel}" aria-label="${copyLabel}">` +
      `<span class="material-symbols-outlined" aria-hidden="true">content_copy</span>` +
      `</button>` +
      `</div>`;

    return (
      `<div class="md-pre-wrap${showLines ? " has-lines is-collapsible is-collapsed" : ""}">` +
      metaHtml +
      `<div class="md-pre-box">` +
      toolsHtml +
      `<pre class="md-pre"><code>${codeHtml}</code></pre>` +
      `</div>` +
      `</div>\n`
    );
  }

  /** Plain code of a rendered block (without gutter line numbers). */
  function codeBlockPlainText(wrap) {
    const code = wrap?.querySelector(".md-pre code");
    if (!code) {
      return "";
    }
    const lines = code.querySelectorAll(".md-line-text");
    if (lines.length) {
      return Array.from(lines, (el) => el.textContent || "").join("\n");
    }
    return code.textContent || "";
  }

  /** Toolbar on code blocks: toggle soft wrap, copy the code. */
  function handleCodeBlockAction(btn) {
    const wrap = btn?.closest(".md-pre-wrap");
    if (!wrap) {
      return;
    }
    const action = btn.getAttribute("data-code-action");
    if (action === "wrap") {
      const on = wrap.classList.toggle("is-wrapped");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      return;
    }
    if (action === "copy") {
      const text = codeBlockPlainText(wrap);
      if (!text) {
        return;
      }
      const done = () => showCopyToast(t("copied"));
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => {
          host.postMessage({ type: "copyText", text });
        });
        return;
      }
      host.postMessage({ type: "copyText", text });
    }
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

  /**
   * Plan-heading + list blocks that duplicate the visible update_todo card.
   * Matched only outside <proposed_plan> tags (those stay the Build card).
   */
  const TODO_PLAN_HEADING_RE =
    /^(?:#{1,6}[ \t]*)?(?:План(?:\s+(?:работ|реализации|действий|изменений|выполнения))?|Plan(?:\s+(?:of\s+work|of\s+action|implementation|changes|execution))?|Implementation\s+plan|Что\s+(?:я\s+)?буду\s+делать|What\s+(?:I\s+)?(?:will|'ll)\s+do|Действия|Actions|Шаги|Steps)\s*:?\s*$/i;

  const TODO_PLAN_ITEM_RE = /^[ \t]*(?:\d+[.)]|[-*+•])\s+\S/;

  /**
   * Drop «План работ:» / «Implementation plan:» heading + step list from the
   * assistant text when the turn already shows a plan checklist card — the
   * text plan is a duplicate. Leaves non-plan narrative intact. No-op when
   * <proposed_plan> tags are present (Build card path owns that text).
   */
  function stripTodoDuplicatedPlanText(text) {
    const value = String(text || "");
    if (!value.trim()) {
      return "";
    }
    if (/(?:<proposed_plan>|&lt;proposed_plan&gt;)/i.test(value)) {
      return value;
    }
    const lines = value.split(/\r?\n/);
    const out = [];
    let i = 0;
    let strippedAny = false;
    while (i < lines.length) {
      if (TODO_PLAN_HEADING_RE.test(lines[i].trim())) {
        i += 1;
        while (i < lines.length && !lines[i].trim()) {
          i += 1;
        }
        let sawItem = false;
        while (i < lines.length) {
          if (TODO_PLAN_ITEM_RE.test(lines[i])) {
            sawItem = true;
            i += 1;
            continue;
          }
          if (!lines[i].trim()) {
            let j = i;
            while (j < lines.length && !lines[j].trim()) {
              j += 1;
            }
            if (j < lines.length && TODO_PLAN_ITEM_RE.test(lines[j])) {
              i = j;
              continue;
            }
          }
          break;
        }
        if (sawItem) {
          strippedAny = true;
        }
        continue;
      }
      out.push(lines[i]);
      i += 1;
    }
    if (!strippedAny) {
      return value;
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /**
   * When the turn already has a visible update_todo plan card, strip the
   * duplicated text plan from the assistant bubble before render/copy.
   */
  function maybeStripTodoPlanText(el, text) {
    const value = String(text || "");
    if (!value.trim()) {
      return value;
    }
    const turn =
      (el && el.closest && el.closest(".chat-turn")) ||
      (typeof currentChatTurnEl !== "undefined" &&
      currentChatTurnEl &&
      typeof messagesEl !== "undefined" &&
      messagesEl.contains(currentChatTurnEl)
        ? currentChatTurnEl
        : null);
    const hasTodoCard = Boolean(
      turn && turn.querySelector && turn.querySelector(".agent-step-todo")
    );
    if (!hasTodoCard) {
      return value;
    }
    return stripTodoDuplicatedPlanText(value);
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
