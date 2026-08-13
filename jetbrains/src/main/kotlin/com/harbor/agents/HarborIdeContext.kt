package com.harbor.agents

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerEx
import com.intellij.codeInsight.daemon.impl.HighlightInfo
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/**
 * Snapshot of the JetBrains editor for Harbor sidecar [vscodeHeadlessStub].
 * Sidecar has no real vscode.window / Problems — without this, turn context is empty.
 */
object HarborIdeContext {
  private const val MAX_FILE_TEXT = 12_000
  private const val MAX_SELECTION = 800
  private const val MAX_OPEN_FILES = 12
  private const val MAX_DIAGNOSTICS = 24
  private val gson = Gson()

  fun toJson(project: Project): JsonElement = gson.toJsonTree(snapshot(project))

  fun snapshot(project: Project): Map<String, Any> {
    val app = ApplicationManager.getApplication()
    return if (app.isReadAccessAllowed) {
      capture(project)
    } else {
      app.runReadAction<Map<String, Any>> { capture(project) }
    }
  }

  private fun capture(project: Project): Map<String, Any> {
    val fem = FileEditorManager.getInstance(project)
    val selectedEditor = fem.selectedTextEditor
    val selectedFile = selectedEditor?.let { FileDocumentManager.getInstance().getFile(it.document) }
    val openFiles = fem.openFiles.take(MAX_OPEN_FILES)

    val editors = mutableListOf<Map<String, Any?>>()
    if (selectedEditor != null && selectedFile != null) {
      editors.add(editorSnapshot(project, selectedEditor, selectedFile, selected = true))
    }
    for (vf in openFiles) {
      if (selectedFile != null && vf.path == selectedFile.path) continue
      val doc = FileDocumentManager.getInstance().getDocument(vf) ?: continue
      editors.add(
        mapOf(
          "fsPath" to vf.path,
          "relativePath" to HarborComposerBridge.relativePath(project, vf),
          "languageId" to languageIdFor(vf),
          "text" to doc.text.take(MAX_FILE_TEXT),
          "lineCount" to doc.lineCount.coerceAtLeast(1),
          "cursorLine" to 0,
          "cursorCharacter" to 0,
          "selectionStartLine" to 0,
          "selectionStartCharacter" to 0,
          "selectionEndLine" to 0,
          "selectionEndCharacter" to 0,
          "selectedText" to "",
          "isEmptySelection" to true,
        ),
      )
    }

    val diagnostics = mutableListOf<Map<String, Any>>()
    val seen = LinkedHashSet<String>()
    val filesForDiag = buildList {
      if (selectedFile != null) add(selectedFile)
      addAll(openFiles)
    }
    for (vf in filesForDiag) {
      if (!seen.add(vf.path)) continue
      diagnostics.addAll(diagnosticsFor(project, vf))
      if (diagnostics.size >= MAX_DIAGNOSTICS) break
    }

    return mapOf(
      "editors" to editors,
      "diagnostics" to diagnostics.take(MAX_DIAGNOSTICS),
    )
  }

  private fun editorSnapshot(
    project: Project,
    editor: Editor,
    vf: VirtualFile,
    selected: Boolean,
  ): Map<String, Any?> {
    val doc = editor.document
    val caret = editor.caretModel.currentCaret
    val start = caret.selectionStart
    val end = caret.selectionEnd
    val startLine = doc.getLineNumber(start.coerceIn(0, doc.textLength))
    val endLine = doc.getLineNumber(end.coerceIn(0, doc.textLength))
    val startCol = start - doc.getLineStartOffset(startLine)
    val endCol = end - doc.getLineStartOffset(endLine)
    val selectedText = if (start == end) {
      ""
    } else {
      doc.text.substring(start.coerceIn(0, doc.textLength), end.coerceIn(0, doc.textLength)).take(MAX_SELECTION)
    }
    return mapOf(
      "fsPath" to vf.path,
      "relativePath" to HarborComposerBridge.relativePath(project, vf),
      "languageId" to languageIdFor(vf),
      "text" to doc.text.take(MAX_FILE_TEXT),
      "lineCount" to doc.lineCount.coerceAtLeast(1),
      "cursorLine" to caret.logicalPosition.line,
      "cursorCharacter" to caret.logicalPosition.column,
      "selectionStartLine" to startLine,
      "selectionStartCharacter" to startCol.coerceAtLeast(0),
      "selectionEndLine" to endLine,
      "selectionEndCharacter" to endCol.coerceAtLeast(0),
      "selectedText" to selectedText,
      "isEmptySelection" to (start == end),
      "selected" to selected,
    )
  }

  private fun diagnosticsFor(project: Project, vf: VirtualFile): List<Map<String, Any>> {
    val document = FileDocumentManager.getInstance().getDocument(vf) ?: return emptyList()
    val out = mutableListOf<Map<String, Any>>()
    DaemonCodeAnalyzerEx.processHighlights(
      document,
      project,
      HighlightSeverity.WARNING,
      0,
      document.textLength,
    ) { info: HighlightInfo ->
      if (out.size >= MAX_DIAGNOSTICS) return@processHighlights false
      val message = info.description?.trim().orEmpty()
      if (message.isEmpty()) return@processHighlights true
      val offset = info.actualStartOffset.coerceIn(0, document.textLength)
      val line = document.getLineNumber(offset)
      val col = offset - document.getLineStartOffset(line)
      val severity = if (info.severity.compareTo(HighlightSeverity.ERROR) >= 0) 0 else 1
      out.add(
        mapOf(
          "fsPath" to vf.path,
          "severity" to severity,
          "message" to message.take(240),
          "line" to line,
          "character" to col.coerceAtLeast(0),
        ),
      )
      true
    }
    return out
  }

  private fun languageIdFor(file: VirtualFile): String {
    val ext = file.extension?.lowercase() ?: return "plaintext"
    return when (ext) {
      "ts" -> "typescript"
      "tsx" -> "typescriptreact"
      "js", "mjs", "cjs" -> "javascript"
      "jsx" -> "javascriptreact"
      "kt", "kts" -> "kotlin"
      "java" -> "java"
      "py" -> "python"
      "go" -> "go"
      "rs" -> "rust"
      "json" -> "json"
      "md" -> "markdown"
      "css" -> "css"
      "html", "htm" -> "html"
      "xml" -> "xml"
      "yml", "yaml" -> "yaml"
      "sh", "bash", "zsh" -> "shellscript"
      else -> ext
    }
  }
}
