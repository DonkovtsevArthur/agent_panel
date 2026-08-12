package com.harbor.agents

import com.google.gson.JsonObject
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingUtilities

/**
 * Thin Kotlin shell: localhost HTTP serves the real VS Code `media/` UI,
 * JCEF loads it, JSQuery ↔ sidecar.
 *
 * Do **not** use `file://` (remote JCEF breaks JSQuery) or multi-MB `loadHTML`.
 */
class HarborJcefSession(
  private val project: Project,
  private val parent: JPanel,
  private val parentDisposable: Disposable,
  private val onStatus: (String) -> Unit,
) : Disposable, HarborWebSession {
  private val log = Logger.getInstance(HarborJcefSession::class.java)
  private val browser: JBCefBrowser =
    JBCefBrowser.createBuilder()
      .setOffScreenRendering(true)
      .build()
  private val vfsRefresh = HarborVfsRefreshService(project)
  private val sidecar = HarborProjectService.getInstance(project).getOrCreateSidecar()
  private val uiRoot = HarborUiServer.materializeRoot()
  private val uiServer = HarborUiServer(uiRoot)
  private val hostBridge =
    HarborHostBridge(
      project,
      browser,
      sidecar,
      vfsRefresh,
      onCloseSettings = {
        SwingUtilities.invokeLater { openChatSurface() }
      },
      onShowSettings = {
        SwingUtilities.invokeLater { openSettingsSurface() }
      },
    )
  private var settingsOpen: Boolean = false

  init {
    Disposer.register(parentDisposable, this)
    Disposer.register(this, browser)
    Disposer.register(this, hostBridge)
    parent.add(browser.component, BorderLayout.CENTER)
    HarborJcefFocus.install(browser)
    HarborJcefChrome.install(browser)
    HarborFileDrop.install(
      browser.component,
      onAttachments = { attachments ->
        hostBridge.postToWebview(
          HarborFileDrop.attachmentsJson(attachments),
          forceRepaint = true,
        )
      },
      onDragActive = { active ->
        val script =
          if (active) {
            """
            (function(){
              try {
                var c = document.getElementById('composer');
                if (c) c.classList.add('is-drop-target');
                var h = document.getElementById('composerDropHint');
                if (h) h.hidden = false;
              } catch (e) {}
            })();
            """.trimIndent()
          } else {
            """
            (function(){
              try {
                var c = document.getElementById('composer');
                if (c) c.classList.remove('is-drop-target');
                var h = document.getElementById('composerDropHint');
                if (h) h.hidden = true;
              } catch (e) {}
            })();
            """.trimIndent()
          }
        javax.swing.SwingUtilities.invokeLater {
          try {
            browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
          } catch (_: Throwable) {
          }
        }
      },
    )
    loadHarborUi()
    onStatus("")
    javax.swing.Timer(800) {
      hostBridge.requestReady(surface = "panel")
      focusBrowser()
      HarborJcefFocus.install(browser)
    }.also {
      it.isRepeats = false
      it.start()
    }
  }

  fun component(): JComponent = browser.component

  override fun openSettingsSurface(): Boolean {
    settingsOpen = true
    focusBrowser()
    val msg = JsonObject()
    msg.addProperty("type", "showSettings")
    sidecar.request("webview.handle", msg) { }
    hostBridge.injectSettingsChrome()
    return true
  }

  override fun openSettingsModal(): Boolean = openSettingsSurface()

  override fun closeSettingsModal() {
    openChatSurface()
  }

  override fun openChatSurface() {
    settingsOpen = false
    focusBrowser()
    hostBridge.removeSettingsChrome()
    hostBridge.requestReady(surface = "panel")
  }

  override fun postToWebview(json: String, forceRepaint: Boolean) {
    hostBridge.postToWebview(json, forceRepaint = forceRepaint)
  }

  private fun loadHarborUi() {
    try {
      HarborWebviewHtml.materialize(project, uiRoot, surface = "panel")
      val url = uiServer.start()
      browser.loadURL(url)
      log.info("Harbor Agents webview loadURL $url (VS Code media via localhost)")
    } catch (t: Throwable) {
      log.warn("Harbor UI load failed", t)
      onStatus("Harbor UI load failed: ${t.message}")
    }
  }

  private fun focusBrowser() {
    SwingUtilities.invokeLater {
      try {
        browser.component.isFocusable = true
        browser.component.requestFocusInWindow()
        browser.cefBrowser.uiComponent.isFocusable = true
        browser.cefBrowser.uiComponent.requestFocusInWindow()
        browser.cefBrowser.setFocus(true)
      } catch (t: Throwable) {
        log.warn("focusBrowser failed", t)
      }
    }
  }

  override fun dispose() {
    try {
      uiServer.close()
    } catch (_: Throwable) {
    }
    try {
      parent.remove(browser.component)
    } catch (_: Throwable) {
    }
  }

  companion object {
    @JvmStatic
    fun tryCreate(
      project: Project,
      parent: JPanel,
      parentDisposable: Disposable,
      onStatus: HarborStatusSink,
    ): HarborWebSession? {
      return try {
        if (!HarborJcef.isSupported()) return null
        Class.forName("com.intellij.ui.jcef.JBCefBrowser")
        HarborJcefSession(project, parent, parentDisposable) { onStatus.setStatus(it) }
      } catch (t: Throwable) {
        Logger.getInstance(HarborJcefSession::class.java)
          .warn("HarborJcefSession.tryCreate failed", t)
        null
      }
    }
  }
}
