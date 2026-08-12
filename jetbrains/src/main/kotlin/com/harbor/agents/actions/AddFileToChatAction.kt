package com.harbor.agents.actions

import com.harbor.agents.HarborComposerBridge
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.vfs.VirtualFile

class AddFileToChatAction : DumbAwareAction() {
  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    val files = collectFiles(e)
    if (files.isEmpty()) {
      return
    }
    HarborComposerBridge.addFiles(project, files, newChat = false)
  }

  override fun update(e: AnActionEvent) {
    e.presentation.isEnabledAndVisible =
      e.project != null && collectFiles(e).isNotEmpty()
  }

  override fun getActionUpdateThread() =
    com.intellij.openapi.actionSystem.ActionUpdateThread.BGT

  companion object {
    fun collectFiles(e: AnActionEvent): List<VirtualFile> {
      val many = e.getData(CommonDataKeys.VIRTUAL_FILE_ARRAY)
      if (many != null && many.isNotEmpty()) {
        return many.filter { !it.isDirectory }
      }
      val one = e.getData(CommonDataKeys.VIRTUAL_FILE)
      if (one != null && !one.isDirectory) {
        return listOf(one)
      }
      // Editor: current file
      val editor = e.getData(CommonDataKeys.EDITOR) ?: return emptyList()
      val vf =
        com.intellij.openapi.fileEditor.FileDocumentManager.getInstance()
          .getFile(editor.document)
      return if (vf != null && !vf.isDirectory) listOf(vf) else emptyList()
    }
  }
}
