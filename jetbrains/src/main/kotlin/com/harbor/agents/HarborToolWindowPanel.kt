package com.harbor.agents

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import java.awt.BorderLayout
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.SwingConstants

/**
 * Tool window shell. Does not reference HarborJcefSession / JBCef* types.
 * Full-bleed webview (no Swing status strip) so the UI matches VS Code.
 */
class HarborToolWindowPanel(private val project: Project) : JPanel(BorderLayout()), Disposable {
  private val log = Logger.getInstance(HarborToolWindowPanel::class.java)
  private var session: HarborWebSession? = null

  init {
    HarborProjectService.getInstance(project).registerToolWindowPanel(this)
    startUi()
  }

  private fun startUi() {
    if (!HarborJcef.isSupported()) {
      showJcefMissing(
        "JCEF classes are not available. Enable the bundled <b>Web Browser (JCEF)</b> plugin " +
          "(Settings → Plugins), restart the IDE, then Reload Harbor."
      )
      return
    }
    val created = HarborJcefBootstrap.create(
      project,
      this,
      this,
      HarborStatusSink { /* status stays in IDE logs; keep webview full-bleed */ },
    )
    if (created == null) {
      showJcefMissing(
        "Could not start embedded browser. Enable <b>Web Browser (JCEF)</b>, restart, then Reload Harbor."
      )
      return
    }
    session = created
  }

  private fun showJcefMissing(detail: String) {
    components.forEach { remove(it) }
    add(
      JLabel(
        "<html><body style='padding:16px;width:280px'>" +
          "<b>Harbor Agents needs the IDE embedded browser</b><br/><br/>" +
          "$detail<br/><br/>" +
          "Toolbar <b>Settings</b> opens Harbor settings in this panel once JCEF is available." +
          "</body></html>",
        SwingConstants.CENTER
      ),
      BorderLayout.CENTER
    )
    revalidate()
    repaint()
  }

  fun openSettingsSurface(): Boolean = session?.openSettingsSurface() ?: false

  fun openSettingsModal(): Boolean = session?.openSettingsModal() ?: false

  fun closeSettingsModal() {
    session?.closeSettingsModal()
  }

  fun openChatSurface() {
    session?.openChatSurface()
  }

  fun postToWebview(json: String, forceRepaint: Boolean = false) {
    session?.postToWebview(json, forceRepaint)
  }

  fun reload() {
    try {
      session?.let { s ->
        if (s is Disposable) {
          Disposer.dispose(s)
        }
      }
      session = null
      components.forEach { remove(it) }
      HarborProjectService.getInstance(project).restartSidecar()
      startUi()
      revalidate()
      repaint()
    } catch (t: Throwable) {
      log.warn("Harbor reload failed", t)
    }
  }

  override fun dispose() {
    HarborProjectService.getInstance(project).unregisterToolWindowPanel(this)
    session = null
  }
}
