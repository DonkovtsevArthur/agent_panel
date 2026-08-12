package com.harbor.agents.actions

import com.harbor.agents.HarborToolWindowPanel
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.wm.ToolWindowManager

class ReloadHarborAction : DumbAwareAction(
  "Reload",
  "Reload Harbor Agents panel and sidecar",
  AllIcons.Actions.Refresh,
) {
  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    val tw = ToolWindowManager.getInstance(project).getToolWindow("Harbor Agents") ?: return
    tw.show {
      val panel = tw.contentManager.selectedContent?.component as? HarborToolWindowPanel
      panel?.reload()
    }
  }

  override fun update(e: AnActionEvent) {
    e.presentation.isEnabledAndVisible = e.project != null
  }
}
