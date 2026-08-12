package com.harbor.agents.actions

import com.harbor.agents.HarborComposerBridge
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction

class AddFileToNewChatAction : DumbAwareAction() {
  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    val files = AddFileToChatAction.collectFiles(e)
    if (files.isEmpty()) {
      return
    }
    HarborComposerBridge.addFiles(project, files, newChat = true)
  }

  override fun update(e: AnActionEvent) {
    e.presentation.isEnabledAndVisible =
      e.project != null && AddFileToChatAction.collectFiles(e).isNotEmpty()
  }

  override fun getActionUpdateThread() =
    com.intellij.openapi.actionSystem.ActionUpdateThread.BGT
}
