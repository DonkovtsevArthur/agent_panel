package com.harbor.agents

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import java.awt.datatransfer.StringSelection
import java.io.File
import java.util.UUID
import java.util.Base64
/**
 * Bridges JCEF `window.__harborHost.postMessage` ↔ Kotlin ↔ Node sidecar.
 */
class HarborHostBridge(
  private val project: Project,
  private val browser: JBCefBrowser,
  private val sidecar: HarborSidecarProcess,
  private val vfsRefresh: HarborVfsRefreshService,
  private val onCloseSettings: (() -> Unit)? = null,
  private val onShowSettings: (() -> Unit)? = null,
) : Disposable {
  private val log = Logger.getInstance(HarborHostBridge::class.java)
  private val gson = Gson()
  private val jsQuery: JBCefJSQuery = JBCefJSQuery.create(browser as JBCefBrowserBase)
  private var removeListener: (() -> Unit)? = null
  @Volatile private var lastReadyAt = 0L
  @Volatile private var lastReadySurface = ""

  init {
    jsQuery.addHandler { payload ->
      try {
        handleWebviewMessage(payload)
      } catch (t: Throwable) {
        log.warn("Harbor host bridge error", t)
      }
      null
    }

    browser.jbCefClient.addLoadHandler(object : org.cef.handler.CefLoadHandlerAdapter() {
      override fun onLoadingStateChange(
        browser: org.cef.browser.CefBrowser?,
        isLoading: Boolean,
        canGoBack: Boolean,
        canGoForward: Boolean,
      ) {
        if (!isLoading) {
          injectBridge()
        }
      }
    }, browser.cefBrowser)

    removeListener = sidecar.addNotificationListener { method, params ->
      when (method) {
        "hostToWebview" -> postToWebview(gson.toJson(params))
        "host.openExternal" -> {
          var url = params?.get("url")?.asString?.trim().orEmpty()
          if (url.startsWith("file://https://", ignoreCase = true) ||
            url.startsWith("file://http://", ignoreCase = true)
          ) {
            url = url.replaceFirst(Regex("^file:/+", RegexOption.IGNORE_CASE), "")
          }
          if (url.startsWith("http://", ignoreCase = true) ||
            url.startsWith("https://", ignoreCase = true)
          ) {
            ApplicationManager.getApplication().invokeLater {
              BrowserUtil.browse(url)
            }
          }
        }
        "vfs.refresh" -> {
          val paths = params?.getAsJsonArray("paths")?.mapNotNull { it.asString } ?: emptyList()
          vfsRefresh.refresh(paths)
        }
        "turn.review" -> {
          val paths = mutableListOf<String>()
          params?.getAsJsonArray("paths")?.forEach { paths.add(it.asString) }
          params?.getAsJsonArray("edits")?.forEach { el ->
            if (el.isJsonObject) {
              el.asJsonObject.get("path")?.asString?.let { paths.add(it) }
            }
          }
          if (paths.isNotEmpty()) {
            vfsRefresh.refresh(paths)
          }
          if (params != null) {
            postToWebview(gson.toJson(params))
          }
        }
        "turn.delta" -> {
          val text = params?.get("text")?.asString
          if (text != null) {
            postToWebview(gson.toJson(mapOf("type" to "assistantDelta", "text" to text)))
          }
        }
        "turn.idle" -> postToWebview("""{"type":"idle"}""")
        "turn.failed" -> {
          val message = params?.get("error")?.asString ?: "Turn failed"
          postToWebview(gson.toJson(mapOf("type" to "runFailed", "message" to message)))
        }
        else -> {
          if (method.startsWith("turn.")) {
            val obj = JsonObject()
            obj.addProperty("type", method)
            if (params != null) obj.add("params", params)
            postToWebview(gson.toJson(obj))
          }
        }
      }
    }
  }

  private fun injectBridge() {
    val inject = """
      (function() {
        window.__harborPostToIde = function(json) {
          ${jsQuery.inject("json")}
        };
        if (window.__harborFlushQueue) window.__harborFlushQueue();
        if (window.__harborSendReady) window.__harborSendReady();
        console.log('[harbor] JSQuery bridge ready');
      })();
    """.trimIndent()
    log.info("Harbor inject JSQuery bridge url=${browser.cefBrowser.url}")
    browser.cefBrowser.executeJavaScript(inject, browser.cefBrowser.url, 0)
  }

  /**
   * Settings in the **same** tool-window webview, using the same `data-surface=settings`
   * CSS path as VS Code (no absolute overlays / second browser).
   */
  fun injectSettingsChrome() {
    val themeJson = gson.toJson(HarborThemeCss.rootVariables())
    val script = """
      (function() {
        var theme = document.getElementById('harbor-jb-theme');
        if (!theme) {
          theme = document.createElement('style');
          theme.id = 'harbor-jb-theme';
          document.head.appendChild(theme);
        }
        theme.textContent = $themeJson;

        document.documentElement.setAttribute('data-surface', 'settings');
        document.documentElement.setAttribute('data-harbor-host', 'jetbrains');

        document.querySelectorAll(
          '.model-menu, .composer-plus-menu, .mention-menu, .settings-modal, .settings-model-tip, .copy-toast'
        ).forEach(function (el) { el.hidden = true; });

        var shell = document.getElementById('workspaceShell');
        if (shell) shell.hidden = true;
        var archive = document.getElementById('archiveScreen');
        if (archive) archive.hidden = true;
        var chat = document.getElementById('chatScreen');
        if (chat) chat.hidden = true;
        var agents = document.getElementById('agentsScreen');
        if (agents) agents.hidden = true;

        var settings = document.getElementById('settingsScreen');
        if (settings) {
          settings.hidden = false;
          settings.style.cssText = '';
        }

        if (settings && !document.getElementById('harborSettingsChrome')) {
          var chrome = document.createElement('div');
          chrome.id = 'harborSettingsChrome';
          chrome.setAttribute('role', 'banner');
          var back = document.createElement('button');
          back.type = 'button';
          back.id = 'harborCloseSettings';
          back.className = 'icon-btn';
          back.title = 'Close settings';
          back.setAttribute('aria-label', 'Close settings');
          back.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>';
          back.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            window.__harborHost.postMessage({ type: 'closeSettings' });
          });
          var title = document.createElement('div');
          title.textContent = 'Settings';
          title.style.cssText = 'font-weight:600;flex:1;font-size:13px';
          chrome.appendChild(back);
          chrome.appendChild(title);
          settings.insertBefore(chrome, settings.firstChild);
        }

        window.dispatchEvent(new MessageEvent('message', {
          data: { type: 'showSettings' }
        }));
      })();
    """.trimIndent()
    ApplicationManager.getApplication().invokeLater {
      browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }
  }

  fun removeSettingsChrome() {
    val script = """
      (function() {
        document.documentElement.setAttribute('data-surface', 'panel');
        var chrome = document.getElementById('harborSettingsChrome');
        if (chrome) chrome.remove();
        var settings = document.getElementById('settingsScreen');
        if (settings) {
          settings.hidden = true;
          settings.style.cssText = '';
        }
        var shell = document.getElementById('workspaceShell');
        if (shell) shell.hidden = false;
      })();
    """.trimIndent()
    ApplicationManager.getApplication().invokeLater {
      browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }
  }

  /**
   * Extra nav binding in capture phase.
   */
  fun bindSettingsNavClicks() {
    val script = """
      (function() {
        var nav = document.getElementById('settingsNav');
        if (!nav || nav.dataset.harborNavBound === '1') return;
        nav.dataset.harborNavBound = '1';
        function activate(cat) {
          if (!cat) return;
          nav.querySelectorAll('.settings-nav-item').forEach(function(btn) {
            btn.classList.toggle('is-active', btn.getAttribute('data-settings-cat') === cat);
          });
          document.querySelectorAll('[data-settings-panel]').forEach(function(panel) {
            panel.hidden = panel.getAttribute('data-settings-panel') !== cat;
          });
          var body = document.getElementById('settingsBody');
          if (body) body.scrollTop = 0;
        }
        function onPointer(e) {
          var t = e.target;
          if (!t || !t.closest) return;
          var btn = t.closest('.settings-nav-item');
          if (!btn || !nav.contains(btn)) return;
          var cat = btn.getAttribute('data-settings-cat');
          if (!cat) return;
          e.preventDefault();
          e.stopPropagation();
          activate(cat);
        }
        nav.addEventListener('pointerdown', onPointer, true);
        nav.addEventListener('click', onPointer, true);
      })();
    """.trimIndent()
    ApplicationManager.getApplication().invokeLater {
      browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }
  }

  /** Ensure + Model / + Provider stay above any layout layer. */
  fun bindSettingsActionClicks() {
    val script = """
      (function() {
        ['addModelBtn', 'addProviderBtn'].forEach(function (id) {
          var el = document.getElementById(id);
          if (!el) return;
          el.style.pointerEvents = 'auto';
          el.style.cursor = 'pointer';
          el.style.position = 'relative';
          el.style.zIndex = '5';
        });
      })();
    """.trimIndent()
    ApplicationManager.getApplication().invokeLater {
      browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }
  }

  /** Ask the webview to re-send ready (after sidecar comes up). Debounced. */
  fun requestReady(surface: String = "panel") {
    val now = System.currentTimeMillis()
    if (surface == lastReadySurface && now - lastReadyAt < 1500) {
      return
    }
    lastReadyAt = now
    lastReadySurface = surface
    val script = """
      (function() {
        if (window.__harborHost) {
          window.__harborHost.postMessage({ type: 'ready', surface: '$surface' });
        } else if (window.__harborSendReady) {
          window.__harborSendReady();
        }
      })();
    """.trimIndent()
    ApplicationManager.getApplication().invokeLater {
      browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
      if (surface == "settings") {
        bindSettingsNavClicks()
      }
    }
  }

  private fun handleWebviewMessage(payload: String) {
    val el = JsonParser.parseString(payload)
    if (!el.isJsonObject) return
    val obj = el.asJsonObject
    val type = obj.get("type")?.asString ?: return
    if (type == "ready" || type == "send" || type == "stop" || type == "newAgent" ||
      type == "showSettings" || type == "deleteAgent" || type == "archiveAgent" ||
      type == "restoreAgent" || type == "deleteAllArchived" ||
      type == "deleteBranch" || type == "branchFromMessage" || type == "switchBranch"
    ) {
      log.info("Harbor webview→host type=$type")
    }

    when (type) {
      "openExternal" -> {
        val url = obj.get("url")?.asString ?: return
        BrowserUtil.browse(url)
      }
      "openFile", "openFileDiff" -> {
        val raw = obj.get("path")?.asString ?: return
        val base = project.basePath
        val io = File(raw)
        val resolved =
          if (io.isAbsolute) io
          else if (!base.isNullOrBlank()) File(base, raw)
          else io
        val lfs = LocalFileSystem.getInstance()
        val vf =
          lfs.refreshAndFindFileByIoFile(resolved)
            ?: lfs.findFileByIoFile(resolved)
            ?: return
        FileEditorManager.getInstance(project).openFile(vf, true)
      }
      "skillsOpenPath" -> {
        val raw = obj.get("path")?.asString ?: return
        val io = File(raw)
        val resolved =
          if (io.isAbsolute) io
          else if (!project.basePath.isNullOrBlank()) File(project.basePath, raw)
          else io
        val lfs = LocalFileSystem.getInstance()
        var vf =
          lfs.refreshAndFindFileByIoFile(resolved)
            ?: lfs.findFileByIoFile(resolved)
            ?: return
        if (vf.isDirectory) {
          vf = vf.findChild("SKILL.md") ?: vf
        }
        if (!vf.isDirectory) {
          FileEditorManager.getInstance(project).openFile(vf, true)
        }
      }
      "skillsPickDirectory" -> {
        ApplicationManager.getApplication().invokeLater {
          val descriptor =
            FileChooserDescriptor(
              /* chooseFiles = */ false,
              /* chooseFolders = */ true,
              /* chooseJars = */ false,
              /* chooseJarsAsFiles = */ false,
              /* chooseJarContents = */ false,
              /* chooseMultiple = */ false,
            ).withTitle("Add skills folder")
          val chosen = FileChooser.chooseFiles(descriptor, project, null)
          val folder = chosen.firstOrNull() ?: return@invokeLater
          sidecar.request(
            "webview.handle",
            gson.toJsonTree(
              mapOf(
                "type" to "skillsAddDirectory",
                "path" to folder.path,
              )
            ),
          ) { _ -> }
        }
      }
      "copyText" -> {
        val text = obj.get("text")?.asString ?: return
        CopyPasteManager.getInstance().setContents(StringSelection(text))
        postToWebview("""{"type":"copied"}""")
      }
      "requestClipboardImage" -> {
        ApplicationManager.getApplication().executeOnPooledThread {
          val attachments = HarborClipboard.readImageAttachments()
          if (attachments.isNotEmpty()) {
            ApplicationManager.getApplication().invokeLater {
              postToWebview(
                gson.toJson(
                  mapOf(
                    "type" to "attachmentsAdded",
                    "attachments" to attachments,
                  )
                ),
                forceRepaint = true,
              )
            }
          }
        }
      }
      "uiRepaint" -> scheduleBrowserRepaint()
      "jcefChrome" -> {
        val cursor = obj.get("cursor")?.asString.orEmpty()
        val title = obj.get("title")?.asString.orEmpty()
        val xEl = obj.get("x")
        val yEl = obj.get("y")
        val x = if (xEl != null && xEl.isJsonPrimitive) xEl.asInt else null
        val y = if (yEl != null && yEl.isJsonPrimitive) yEl.asInt else null
        HarborJcefChrome.applyFromWebview(browser, cursor, title, x, y)
      }
      "openPlanMarkdown" -> {
        val text = obj.get("text")?.asString ?: return
        val reveal = obj.get("reveal")?.asString ?: "editor"
        ApplicationManager.getApplication().executeOnPooledThread {
          HarborPlan.writeAndOpen(project, text, reveal)
        }
      }
      "requestLivePlanForBuild" -> {
        val requestId = obj.get("requestId")?.asString.orEmpty()
        val fallback = HarborPlan.stripWrapper(obj.get("fallbackText")?.asString)
        ApplicationManager.getApplication().executeOnPooledThread {
          val live = HarborPlan.readLive(project)
          val text = live.ifBlank { fallback }
          ApplicationManager.getApplication().invokeLater {
            postToWebview(
              gson.toJson(
                mapOf(
                  "type" to "livePlanForBuild",
                  "requestId" to requestId,
                  "text" to text,
                )
              )
            )
          }
        }
      }
      "pickAttachments" -> {
        val imagesOnly = obj.get("imagesOnly")?.asBoolean != false
        ApplicationManager.getApplication().invokeLater {
          pickAttachments(imagesOnly)
        }
      }
      "attachUris" -> {
        ApplicationManager.getApplication().executeOnPooledThread {
          val uris = obj.getAsJsonArray("uris") ?: return@executeOnPooledThread
          val attachments = mutableListOf<Map<String, Any>>()
          for (el in uris) {
            val raw = el.asString?.trim().orEmpty()
            if (raw.isEmpty()) continue
            val path =
              when {
                raw.startsWith("file://") ->
                  try {
                    java.net.URI(raw).path
                  } catch (_: Throwable) {
                    raw.removePrefix("file://")
                  }
                else -> raw
              }
            val file = File(path)
            if (!file.isFile) continue
            HarborClipboard.encodeFile(file)?.let { attachments.add(it) }
            if (attachments.size >= 8) break
          }
          if (attachments.isEmpty()) return@executeOnPooledThread
          ApplicationManager.getApplication().invokeLater {
            postToWebview(
              HarborFileDrop.attachmentsJson(attachments),
              forceRepaint = true,
            )
          }
        }
      }
      "openScm" -> {
        ToolWindowManager.getInstance(project).getToolWindow("Commit")?.show()
      }
      "deleteAgent", "deleteAllArchived", "deleteBranch" -> {
        ApplicationManager.getApplication().invokeLater {
          val title = "Harbor Agents"
          val message =
            when (type) {
              "deleteAllArchived" -> "Delete all archived agents permanently?"
              "deleteBranch" -> "Delete this branch permanently?"
              else -> "Delete this agent permanently?"
            }
          val answer = Messages.showYesNoDialog(
            project,
            message,
            title,
            Messages.getWarningIcon(),
          )
          if (answer == Messages.YES) {
            sidecar.request("webview.handle", obj) { _ -> }
          }
        }
      }
      "showSettings" -> {
        ApplicationManager.getApplication().invokeLater {
          val custom = onShowSettings
          if (custom != null) {
            custom.invoke()
          } else {
            HarborSettings.open(project)
          }
        }
      }
      "closeSettings" -> {
        ApplicationManager.getApplication().invokeLater {
          val custom = onCloseSettings
          if (custom != null) {
            custom.invoke()
          } else {
            HarborSettings.close(project)
          }
        }
      }
      "commitAndPush" -> {
        sidecar.request("commit.andPush", obj) { result ->
          ApplicationManager.getApplication().invokeLater {
            vfsRefresh.refresh(emptyList())
            if (result != null) {
              postToWebview(gson.toJson(mapOf("type" to "status", "text" to "commit: $result")))
            }
          }
        }
      }
      else -> {
        sidecar.request("webview.handle", obj) { _ -> }
      }
    }
  }

  private fun pickAttachments(imagesOnly: Boolean) {
    val descriptor =
      FileChooserDescriptor(
        /* chooseFiles = */ true,
        /* chooseFolders = */ false,
        /* chooseJars = */ false,
        /* chooseJarsAsFiles = */ false,
        /* chooseJarContents = */ false,
        /* chooseMultiple = */ true,
      ).withTitle(if (imagesOnly) "Attach images" else "Attach files")
    if (imagesOnly) {
      descriptor.withFileFilter { vf ->
        val ext = vf.extension?.lowercase() ?: return@withFileFilter false
        ext in setOf("png", "jpg", "jpeg", "gif", "webp", "bmp")
      }
    }
    val chosen = FileChooser.chooseFiles(descriptor, project, null)
    if (chosen.isEmpty()) {
      return
    }
    ApplicationManager.getApplication().executeOnPooledThread {
      val attachments = mutableListOf<Map<String, Any>>()
      for (vf in chosen) {
        val io = File(vf.path)
        if (!io.isFile) continue
        val encoded = HarborClipboard.encodeFile(io)
        if (encoded != null) {
          attachments.add(encoded)
        } else if (!imagesOnly) {
          // Non-image: send path reference when possible
          try {
            val bytes = io.readBytes()
            if (bytes.size <= 256 * 1024) {
              val b64 = Base64.getEncoder().encodeToString(bytes)
              attachments.add(
                mapOf(
                  "id" to "file_${UUID.randomUUID().toString().take(8)}",
                  "kind" to "file",
                  "name" to io.name,
                  "mime" to "application/octet-stream",
                  "size" to bytes.size,
                  "dataBase64" to b64,
                  "path" to io.absolutePath,
                )
              )
            }
          } catch (_: Throwable) {
          }
        }
        if (attachments.size >= 8) break
      }
      if (attachments.isEmpty()) {
        return@executeOnPooledThread
      }
      ApplicationManager.getApplication().invokeLater {
        postToWebview(
          gson.toJson(
            mapOf(
              "type" to "attachmentsAdded",
              "attachments" to attachments,
            )
          ),
          forceRepaint = true,
        )
      }
    }
  }

  private fun scheduleBrowserRepaint() {
    ApplicationManager.getApplication().invokeLater {
      try {
        val component = browser.component
        component.revalidate()
        component.repaint()
        // OSR sometimes needs a second tick after img decode.
        javax.swing.Timer(40) {
          try {
            component.repaint()
          } catch (_: Throwable) {
          }
        }.also {
          it.isRepeats = false
          it.start()
        }
        javax.swing.Timer(120) {
          try {
            component.repaint()
          } catch (_: Throwable) {
          }
        }.also {
          it.isRepeats = false
          it.start()
        }
      } catch (t: Throwable) {
        log.warn("Harbor browser repaint failed", t)
      }
    }
  }

  fun postToWebview(json: String, forceRepaint: Boolean = false) {
    val escaped = gson.toJson(json)
    val script = """
      (function() {
        try {
          var msg = JSON.parse($escaped);
          window.dispatchEvent(new MessageEvent('message', { data: msg }));
        } catch (e) { console.error('Harbor postToWebview', e); }
      })();
    """.trimIndent()
    ApplicationManager.getApplication().invokeLater {
      browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
      if (forceRepaint || json.contains("\"attachmentsAdded\"")) {
        scheduleBrowserRepaint()
      }
    }
  }

  override fun dispose() {
    removeListener?.invoke()
    removeListener = null
    jsQuery.dispose()
  }
}
