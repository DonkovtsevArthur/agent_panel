package com.harbor.agents.actions

import com.harbor.agents.HarborComposerBridge
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.DumbAwareAction

class AddSelectionToChatAction : DumbAwareAction() {
  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    val editor = e.getData(CommonDataKeys.EDITOR) ?: return
    HarborComposerBridge.addSelection(project, editor, newChat = false)
  }

  override fun update(e: AnActionEvent) {
    val editor = e.getData(CommonDataKeys.EDITOR)
    e.presentation.isEnabledAndVisible =
      e.project != null && editor != null && editor.selectionModel.hasSelection()
  }

  override fun getActionUpdateThread() =
    com.intellij.openapi.actionSystem.ActionUpdateThread.BGT
}
