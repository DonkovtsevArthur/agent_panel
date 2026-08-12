package com.harbor.agents.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.wm.ToolWindowManager

class OpenHarborAction : AnAction() {
  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    ToolWindowManager.getInstance(project).getToolWindow("Harbor Agents")?.show()
  }
}
