package com.harbor.agents

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.io.FileUtil
import java.io.File
import java.nio.charset.StandardCharsets

/**
 * Materializes the **same** VS Code panel assets (`media/panel.js/css/shell` + fonts)
 * into a directory served by [HarborUiServer].
 *
 * No base64 fonts, no multi-MB loadHTML — identical file layout to the VS Code webview.
 */
object HarborWebviewHtml {
  private val log = Logger.getInstance(HarborWebviewHtml::class.java)

  /**
   * Writes `index.html` + copies `panel.css`, `panel.js`, `marked.js`, fonts, shell
   * into [outDir]. Returns the directory.
   */
  fun materialize(project: Project, outDir: File, surface: String = "panel"): File {
    outDir.mkdirs()
    val mediaRoot = resolveMediaRoot()
    copyAsset(mediaRoot, "panel.css", File(outDir, "panel.css"))
    copyAsset(mediaRoot, "panel.js", File(outDir, "panel.js"))
    copyAsset(mediaRoot, "marked.js", File(outDir, "marked.js"))
    copyAsset(mediaRoot, "panel.shell.html", File(outDir, "panel.shell.html"))
    val fontsDir = File(outDir, "fonts")
    fontsDir.mkdirs()
    copyAsset(mediaRoot, "fonts/MaterialSymbolsOutlined-24-400.ttf", File(fontsDir, "MaterialSymbolsOutlined-24-400.ttf"))
    copyAsset(mediaRoot, "fonts/JetBrainsMono-Regular.ttf", File(fontsDir, "JetBrainsMono-Regular.ttf"))

    val shell = readText(File(outDir, "panel.shell.html")).ifBlank {
      """<div id="workspaceShell" class="workspace-shell"><section id="chatScreen" class="screen chat-screen"><div id="messages"></div></section><section id="settingsScreen" class="screen" hidden></section></div>"""
    }
    val lang = HarborUiLanguage.resolve(project)
    val surfaceAttr = if (surface == "settings") "settings" else "panel"
    val pageTitle = if (surfaceAttr == "settings") "Settings — Harbor Agents" else "Harbor Agents"
    val theme = HarborThemeCss.rootVariables()
    val assetVer = HarborPluginInfo.version()

    val html = """
<!DOCTYPE html>
<html lang="$lang" data-surface="$surfaceAttr" data-harbor-host="jetbrains" style="scrollbar-color: unset; scrollbar-width: unset">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>$pageTitle</title>
  <link rel="stylesheet" href="/panel.css?v=$assetVer" />
  <style id="harbor-jb-theme">
$theme
  </style>
  <style>
    @font-face {
      font-family: "Material Symbols Outlined";
      font-style: normal;
      font-weight: 400;
      font-display: block;
      src: url("/fonts/MaterialSymbolsOutlined-24-400.ttf") format("truetype");
    }
    @font-face {
      font-family: "JetBrains Mono";
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url("/fonts/JetBrainsMono-Regular.ttf") format("truetype");
    }
    html, body { height: 100%; margin: 0; }
    body { display: flex; flex-direction: column; min-height: 0; }
    .screen[hidden] { display: none !important; }
    .settings-modal[hidden],
    .model-menu[hidden],
    .composer-plus-menu[hidden],
    .mention-menu[hidden] { display: none !important; pointer-events: none !important; }
    html[data-harbor-host="jetbrains"][data-surface="settings"] #settingsScreen:not([hidden]) {
      display: flex !important;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      height: 100%;
      padding-top: 0 !important;
      background: var(--vscode-editor-background) !important;
      color: var(--vscode-foreground) !important;
    }
    html[data-harbor-host="jetbrains"] #harborSettingsChrome {
      flex: 0 0 auto;
      height: 40px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
    }
    html[data-harbor-host="jetbrains"] #harborSettingsChrome .icon-btn {
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      padding: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
    }
    html[data-harbor-host="jetbrains"] #harborSettingsChrome .icon-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }
    html[data-harbor-host="jetbrains"] #harborJcefTip {
      position: fixed;
      z-index: 2147483646;
      max-width: min(280px, calc(100vw - 16px));
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background, #2b2b2b));
      color: var(--vscode-editorWidget-foreground, var(--vscode-foreground, #ccc));
      font: 12px/1.35 var(--vscode-font-family, system-ui, sans-serif);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
      pointer-events: none;
      white-space: pre-wrap;
      word-break: break-word;
    }
    html[data-harbor-host="jetbrains"] #harborJcefTip[hidden] {
      display: none !important;
    }
  </style>
</head>
<body>
$shell
  <script>
    (function () {
      var state = null;
      var queue = [];
      var surface = document.documentElement.getAttribute('data-surface') || 'panel';
      function deliver(msg) {
        if (window.__harborPostToIde) {
          window.__harborPostToIde(typeof msg === 'string' ? msg : JSON.stringify(msg));
        } else {
          queue.push(msg);
        }
      }
      window.__harborHost = {
        postMessage: deliver,
        getState: function () { return state; },
        setState: function (s) { state = s; }
      };
      window.__harborFlushQueue = function () {
        var q = queue.splice(0, queue.length);
        q.forEach(function (msg) { deliver(msg); });
      };
      window.__harborSendReady = function () {
        deliver({ type: 'ready', surface: surface });
      };
    })();
  </script>
  <script src="/marked.js?v=$assetVer"></script>
  <script src="/panel.js?v=$assetVer"></script>
</body>
</html>
    """.trimIndent()

    File(outDir, "index.html").writeText(html, StandardCharsets.UTF_8)
    log.info(
      "Harbor UI materialized at ${outDir.absolutePath}/index.html " +
        "(plugin=${HarborPluginInfo.version()} project=${project.name} " +
        "css=${File(outDir, "panel.css").length()} js=${File(outDir, "panel.js").length()} " +
        "mediaRoot=${mediaRoot?.absolutePath ?: "classpath"})"
    )
    return outDir
  }

  /** Kept for callers that still expect a string; prefer [materialize] + HTTP. */
  fun buildInline(project: Project, surface: String = "panel"): String {
    val dir = HarborUiServer.materializeRoot()
    materialize(project, dir, surface)
    return File(dir, "index.html").readText(StandardCharsets.UTF_8)
  }

  fun build(project: Project, surface: String = "panel"): String = buildInline(project, surface)

  private fun resolveMediaRoot(): File? {
    val fromEnv = System.getenv("HARBOR_MEDIA")
    if (!fromEnv.isNullOrBlank()) {
      val f = File(fromEnv)
      if (File(f, "panel.js").exists()) return f.canonicalFile
    }
    // Packaged plugin: always prefer jar classpath (copyAsset fallback).
    // Dev overlay only when HARBOR_DEV=1 — otherwise user.dir can steal
    // an unrelated checkout's media/ and the installed zip never applies.
    if (!HarborPluginInfo.devOverlay()) {
      return null
    }
    val candidates = listOf(
      File(System.getProperty("user.dir"), "../media"),
      File(System.getProperty("user.dir"), "media"),
      File(System.getProperty("user.dir"), "../../media"),
      HarborPluginInfo.pluginPath()?.resolve("harbor/media")?.toFile(),
      HarborPluginInfo.pluginPath()?.resolve("media")?.toFile(),
    )
    for (c in candidates) {
      if (c != null && File(c, "panel.js").exists()) {
        return c.canonicalFile
      }
    }
    return null
  }

  private fun copyAsset(mediaRoot: File?, name: String, dest: File) {
    if (mediaRoot != null) {
      val src = File(mediaRoot, name)
      if (src.exists()) {
        FileUtil.copy(src, dest)
        return
      }
    }
    val stream = HarborWebviewHtml::class.java.getResourceAsStream("/harbor/media/$name")
      ?: HarborWebviewHtml::class.java.getResourceAsStream("/media/$name")
    if (stream != null) {
      stream.use { input -> dest.outputStream().use { input.copyTo(it) } }
      return
    }
    log.warn("Missing Harbor asset: $name")
  }

  private fun readText(file: File): String {
    return if (file.exists()) FileUtil.loadFile(file, StandardCharsets.UTF_8) else ""
  }
}
