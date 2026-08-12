package com.harbor.agents.actions

import com.harbor.agents.HarborSettings
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction

class OpenSettingsAction : DumbAwareAction(
  "Settings",
  "Open Harbor Agents settings",
  AllIcons.General.Settings,
) {
  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    HarborSettings.open(project)
  }

  override fun update(e: AnActionEvent) {
    e.presentation.isEnabledAndVisible = e.project != null
  }
}
