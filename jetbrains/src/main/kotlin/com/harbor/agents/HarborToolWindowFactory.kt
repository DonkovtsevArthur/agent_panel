package com.harbor.agents

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import java.awt.BorderLayout
import javax.swing.JLabel
import javax.swing.JPanel

class HarborToolWindowFactory : ToolWindowFactory, DumbAware {
  override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
    val am = ActionManager.getInstance()
    val titleActions = listOfNotNull(
      am.getAction("HarborAgents.OpenSettings"),
      am.getAction("HarborAgents.NewChat"),
      am.getAction("HarborAgents.Reload"),
    )
    if (titleActions.isNotEmpty()) {
      toolWindow.setTitleActions(titleActions)
    }

    try {
      val panel = HarborToolWindowPanel(project)
      Disposer.register(toolWindow.disposable, panel)
      val content = ContentFactory.getInstance().createContent(panel, "", false)
      content.setDisposer(panel)
      content.isCloseable = false
      toolWindow.contentManager.addContent(content)
    } catch (t: Throwable) {
      val fallback = JPanel(BorderLayout())
      fallback.add(
        JLabel(
          "<html><body style='padding:12px;width:280px'>" +
            "<b>Harbor Agents failed to start</b><br/><br/>" +
            "${t.javaClass.simpleName}: ${t.message ?: "unknown"}<br/><br/>" +
            "Enable <b>Web Browser (JCEF)</b> in Plugins, restart,<br/>" +
            "or open <b>Tools → Settings</b> (simple dialog) for providers." +
            "</body></html>"
        ),
        BorderLayout.CENTER
      )
      val content = ContentFactory.getInstance().createContent(fallback, "", false)
      content.isCloseable = false
      toolWindow.contentManager.addContent(content)
    }
  }
}
