(function () {
  /**
   * Figma markdown — same marked.js as the VS Code webview (media/marked.js),
   * with a slim renderer (no IDE file paths / plan cards / citation fences).
   */

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getMarkedApi() {
    if (typeof marked === "undefined") return null;
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

  var markdownReady = false;

  function ensureMarkdownRenderer() {
    var api = getMarkedApi();
    if (markdownReady) return !!api;
    if (!api || !api.Renderer) return false;
    markdownReady = true;

    var renderer = new api.Renderer();

    renderer.code = function (token) {
      var text = token && token.text != null ? token.text : "";
      var lang = token && token.lang ? String(token.lang) : "";
      var langClass = lang
        ? ' class="language-' + escapeHtml(lang.split(/\s+/)[0]) + '"'
        : "";
      return (
        '<div class="md-pre-wrap">' +
        '<pre class="md-pre"><code' +
        langClass +
        ">" +
        escapeHtml(text) +
        "</code></pre></div>\n"
      );
    };

    renderer.codespan = function (token) {
      return (
        '<code class="md-code">' +
        escapeHtml(token && token.text != null ? token.text : "") +
        "</code>"
      );
    };

    renderer.heading = function (token) {
      var level = Math.min(3, Math.max(1, (token && token.depth) || 1));
      return (
        '<div class="md-h md-h' +
        level +
        '">' +
        this.parser.parseInline(token.tokens) +
        "</div>\n"
      );
    };

    renderer.paragraph = function (token) {
      return (
        '<div class="md-p">' + this.parser.parseInline(token.tokens) + "</div>\n"
      );
    };

    renderer.blockquote = function (token) {
      return (
        '<blockquote class="md-quote">' +
        this.parser.parse(token.tokens) +
        "</blockquote>\n"
      );
    };

    renderer.list = function (token) {
      var tag = token.ordered ? "ol" : "ul";
      var startAttr =
        token.ordered && token.start !== 1 ? ' start="' + token.start + '"' : "";
      var body = "";
      for (var i = 0; i < token.items.length; i++) {
        body += this.listitem(token.items[i]);
      }
      return (
        "<" +
        tag +
        ' class="md-list md-' +
        tag +
        '"' +
        startAttr +
        ">" +
        body +
        "</" +
        tag +
        ">\n"
      );
    };

    renderer.listitem = function (item) {
      var body = "";
      if (item.task) {
        body +=
          '<input class="md-task" type="checkbox" disabled' +
          (item.checked ? " checked" : "") +
          " /> ";
      }
      body += this.parser.parse(item.tokens, !!item.loose);
      return '<li class="md-li">' + body + "</li>\n";
    };

    renderer.checkbox = function () {
      return "";
    };

    renderer.strong = function (token) {
      return (
        '<strong class="md-strong">' +
        this.parser.parseInline(token.tokens) +
        "</strong>"
      );
    };

    renderer.em = function (token) {
      return (
        '<em class="md-em">' + this.parser.parseInline(token.tokens) + "</em>"
      );
    };

    renderer.del = function (token) {
      return (
        '<del class="md-del">' + this.parser.parseInline(token.tokens) + "</del>"
      );
    };

    renderer.link = function (token) {
      var label = this.parser.parseInline(token.tokens);
      var href = String(token.href || "");
      if (!/^https?:\/\//i.test(href)) {
        return label;
      }
      var title = token.title
        ? ' title="' + escapeHtml(token.title) + '"'
        : "";
      return (
        '<a class="md-link" href="' +
        escapeHtml(href) +
        '" target="_blank" rel="noopener noreferrer"' +
        title +
        ">" +
        label +
        "</a>"
      );
    };

    renderer.image = function (token) {
      return escapeHtml((token && (token.text || token.href)) || "");
    };

    renderer.html = function (token) {
      return escapeHtml((token && token.text) || "");
    };

    renderer.hr = function () {
      return '<hr class="md-hr" />\n';
    };

    renderer.br = function () {
      return "<br />";
    };

    renderer.table = function (token) {
      var header = "";
      for (var h = 0; h < token.header.length; h++) {
        header += this.tablecell(token.header[h]);
      }
      var body = "";
      for (var r = 0; r < token.rows.length; r++) {
        var cells = "";
        for (var c = 0; c < token.rows[r].length; c++) {
          cells += this.tablecell(token.rows[r][c]);
        }
        body += this.tablerow({ text: cells });
      }
      return (
        '<div class="md-table-wrap"><table class="md-table"><thead>' +
        this.tablerow({ text: header }) +
        "</thead><tbody>" +
        body +
        "</tbody></table></div>\n"
      );
    };

    renderer.tablerow = function (token) {
      return "<tr>" + token.text + "</tr>\n";
    };

    renderer.tablecell = function (cell) {
      var tag = cell.header ? "th" : "td";
      var align = cell.align ? ' style="text-align:' + cell.align + '"' : "";
      return (
        "<" +
        tag +
        ' class="md-td"' +
        align +
        ">" +
        this.parser.parseInline(cell.tokens) +
        "</" +
        tag +
        ">"
      );
    };

    api.use({
      renderer: renderer,
      gfm: true,
      breaks: true,
      pedantic: false,
    });
    return true;
  }

  function renderMarkdown(text) {
    var raw = String(text || "");
    if (!raw) {
      return '<div class="msg-body"></div>';
    }
    var api = getMarkedApi();
    if (ensureMarkdownRenderer() && api) {
      try {
        var html = api.parse(raw, { async: false });
        return '<div class="msg-body">' + html + "</div>";
      } catch (_e) {
        /* fall through */
      }
    }
    return (
      '<div class="msg-body"><div class="md-p">' +
      escapeHtml(raw).replace(/\n/g, "<br />") +
      "</div></div>"
    );
  }

  window.__harborFigmaMd = {
    renderMarkdown: renderMarkdown,
    escapeHtml: escapeHtml,
  };
})();
