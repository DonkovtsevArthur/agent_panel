package com.harbor.agents

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.ToolWindowManager
import java.io.File
import java.util.UUID

/**
 * Open Harbor chat and push selection chips / file attachments into the webview composer.
 */
object HarborComposerBridge {
  private val gson = Gson()
  private val imageExt = setOf("png", "jpg", "jpeg", "gif", "webp", "bmp")
  private const val MAX_SELECTION_CHARS = 100_000

  fun showChat(
    project: Project,
    newChat: Boolean = false,
    afterReady: (HarborToolWindowPanel) -> Unit,
  ) {
    ApplicationManager.getApplication().invokeLater {
      val tw =
        ToolWindowManager.getInstance(project).getToolWindow("Harbor Agents")
          ?: return@invokeLater
      tw.activate {
        ApplicationManager.getApplication().invokeLater {
          val panel =
            HarborProjectService.getInstance(project).toolWindowPanel()
              ?: return@invokeLater
          panel.openChatSurface()
          if (newChat) {
            val sidecar =
              HarborProjectService.getInstance(project).getOrCreateSidecar()
            val msg = JsonObject().apply { addProperty("type", "newAgent") }
            sidecar.request("webview.handle", msg) { _ -> }
          }
          // Let JCEF paint chat surface before composer insert.
          javax.swing.Timer(400) {
            afterReady(panel)
          }.also {
            it.isRepeats = false
            it.start()
          }
        }
      }
    }
  }

  fun addSelection(
    project: Project,
    editor: Editor,
    newChat: Boolean = false,
  ) {
    val model = editor.selectionModel
    if (!model.hasSelection()) {
      return
    }
    val text = model.selectedText?.trimEnd('\n') ?: return
    if (text.isBlank()) {
      return
    }
    val doc = editor.document
    val startLine = doc.getLineNumber(model.selectionStart) + 1
    val endLine = doc.getLineNumber(model.selectionEnd) + 1
    val vf = FileDocumentManager.getInstance().getFile(doc)
    val path = relativePath(project, vf) ?: vf?.name ?: "file"
    val language = languageIdFor(vf)

    showChat(project, newChat) { panel ->
      postSelection(
        panel,
        path = path,
        startLine = startLine,
        endLine = endLine,
        text = text.take(MAX_SELECTION_CHARS),
        language = language,
      )
    }
  }

  fun addFiles(
    project: Project,
    files: Collection<VirtualFile>,
    newChat: Boolean = false,
  ) {
    val fileAttachments = mutableListOf<Map<String, Any>>()
    val imageAttachments = mutableListOf<Map<String, Any>>()
    for (vf in files) {
      if (vf.isDirectory) {
        continue
      }
      val ext = vf.extension?.lowercase().orEmpty()
      if (ext in imageExt) {
        val io = File(vf.path)
        HarborClipboard.encodeFile(io)?.let { imageAttachments.add(it) }
        continue
      }
      fileAttachment(project, vf)?.let { fileAttachments.add(it) }
    }
    if (fileAttachments.isEmpty() && imageAttachments.isEmpty()) {
      return
    }
    showChat(project, newChat) { panel ->
      val all = fileAttachments + imageAttachments
      if (all.isNotEmpty()) {
        panel.postToWebview(
          HarborFileDrop.attachmentsJson(all),
          forceRepaint = true,
        )
      }
    }
  }

  private fun postSelection(
    panel: HarborToolWindowPanel,
    path: String,
    startLine: Int,
    endLine: Int,
    text: String,
    language: String,
  ) {
    val payload =
      mapOf(
        "type" to "insertComposerSelection",
        "selection" to
          mapOf(
            "path" to path,
            "startLine" to startLine,
            "endLine" to endLine,
            "text" to text,
            "language" to language,
          ),
      )
    panel.postToWebview(gson.toJson(payload), forceRepaint = true)
  }

  private fun fileAttachment(project: Project, vf: VirtualFile): Map<String, Any>? {
    val rel = relativePath(project, vf) ?: return null
    return mapOf(
      "id" to "jb_${UUID.randomUUID().toString().take(8)}",
      "kind" to "file",
      "name" to vf.name,
      "mime" to guessMime(vf.name),
      "path" to rel,
      "size" to vf.length,
    )
  }

  private fun languageIdFor(vf: VirtualFile?): String {
    if (vf == null) {
      return ""
    }
    val ext = vf.extension?.lowercase().orEmpty()
    return when (ext) {
      "ts" -> "typescript"
      "tsx" -> "typescriptreact"
      "js" -> "javascript"
      "jsx" -> "javascriptreact"
      "kt" -> "kotlin"
      "kts" -> "kotlin"
      "py" -> "python"
      "md" -> "markdown"
      "json" -> "json"
      "css" -> "css"
      "html", "htm" -> "html"
      "rs" -> "rust"
      "go" -> "go"
      "java" -> "java"
      "xml" -> "xml"
      "yml", "yaml" -> "yaml"
      "sh" -> "shellscript"
      else -> vf.fileType.name.lowercase().replace(" ", "")
    }
  }

  private fun guessMime(name: String): String {
    val ext = name.substringAfterLast('.', "").lowercase()
    return when (ext) {
      "ts", "tsx", "js", "jsx", "mjs", "cjs" -> "text/javascript"
      "json" -> "application/json"
      "md" -> "text/markdown"
      "css" -> "text/css"
      "html", "htm" -> "text/html"
      "xml" -> "application/xml"
      "py" -> "text/x-python"
      "kt", "kts" -> "text/x-kotlin"
      "java" -> "text/x-java-source"
      "rs" -> "text/x-rust"
      "go" -> "text/x-go"
      "yml", "yaml" -> "text/yaml"
      "txt" -> "text/plain"
      else -> "application/octet-stream"
    }
  }

  fun relativePath(project: Project, vf: VirtualFile?): String? {
    if (vf == null) {
      return null
    }
    val base = project.basePath?.replace('\\', '/') ?: return vf.name
    val abs = vf.path.replace('\\', '/')
    val prefix = if (base.endsWith("/")) base else "$base/"
    return when {
      abs.startsWith(prefix) -> abs.removePrefix(prefix)
      abs == base -> vf.name
      else -> vf.name
    }
  }
}
