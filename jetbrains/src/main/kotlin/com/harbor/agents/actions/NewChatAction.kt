package com.harbor.agents.actions

import com.google.gson.JsonObject
import com.harbor.agents.HarborProjectService
import com.harbor.agents.HarborToolWindowPanel
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.wm.ToolWindowManager

class NewChatAction : DumbAwareAction(
  "New Chat",
  "Start a new Harbor Agents chat",
  AllIcons.General.Add,
) {
  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    val sidecar = project.getService(HarborProjectService::class.java).getOrCreateSidecar()
    val msg = JsonObject().apply { addProperty("type", "newAgent") }
    sidecar.request("webview.handle", msg) { _ -> }
    val tw = ToolWindowManager.getInstance(project).getToolWindow("Harbor Agents")
    tw?.show {
      val panel = tw.contentManager.selectedContent?.component as? HarborToolWindowPanel
      panel?.postToWebview("""{"type":"status","text":"New chat…"}""")
    }
  }

  override fun update(e: AnActionEvent) {
    e.presentation.isEnabledAndVisible = e.project != null
  }
}
