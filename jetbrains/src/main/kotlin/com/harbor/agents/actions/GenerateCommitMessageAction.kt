package com.harbor.agents.actions

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ide.CopyPasteManager
import java.awt.datatransfer.StringSelection

/**
 * MVP: copies a placeholder commit message; full LLM generation via sidecar later.
 */
class GenerateCommitMessageAction : AnAction() {
  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    val placeholder = "chore: update via Harbor Agents"
    CopyPasteManager.getInstance().setContents(StringSelection(placeholder))
    NotificationGroupManager.getInstance()
      .getNotificationGroup("Harbor Agents")
      .createNotification(
        "Commit message placeholder copied to clipboard. " +
          "Paste into the Commit tool window. LLM generation comes next.",
        NotificationType.INFORMATION
      )
      .notify(project)
  }
}
