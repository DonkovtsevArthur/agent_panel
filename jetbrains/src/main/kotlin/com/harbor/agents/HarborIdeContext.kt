package com.harbor.agents

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.intellij.codeInsight.daemon.impl.DaemonCodeAnalyzerEx
import com.intellij.codeInsight.daemon.impl.HighlightInfo
import com.intellij.execution.ui.RunContentManager
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiNamedElement
import java.awt.Component
import java.awt.Container

/**
 * Snapshot of the JetBrains editor for Harbor sidecar [vscodeHeadlessStub].
 * Sidecar has no real vscode.window / Problems — without this, turn context is empty.
 *
 * Must run on the EDT: JCEF JSQuery is not the dispatch thread, and
 * [FileEditorManager.selectedTextEditor] is null while the chat webview has focus.
 */
object HarborIdeContext {
  private const val MAX_FILE_TEXT = 12_000
  private const val MAX_SELECTION = 800
  private const val MAX_OPEN_FILES = 12
  private const val MAX_DIAGNOSTICS = 24
  private val gson = Gson()
  private val log = Logger.getInstance(HarborIdeContext::class.java)

  @Volatile private var lastEditors: List<Map<String, Any?>> = emptyList()

  fun toJson(project: Project): JsonElement = gson.toJsonTree(snapshot(project))

  fun snapshot(project: Project): Map<String, Any> {
    val app = ApplicationManager.getApplication()
    if (app.isDispatchThread) {
      return app.runReadAction<Map<String, Any>> { capture(project) }
    }
    var result: Map<String, Any> = emptyMap()
    app.invokeAndWait(
      { result = app.runReadAction<Map<String, Any>> { capture(project) } },
      ModalityState.any(),
    )
    return result
  }

  private fun capture(project: Project): Map<String, Any> {
    val fem = FileEditorManager.getInstance(project)
    val selectedFile = resolveSelectedFile(fem)
    val selectedEditor = resolveSelectedEditor(fem, selectedFile)
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
    if (editors.isEmpty() && lastEditors.isNotEmpty()) {
      editors.addAll(lastEditors)
    } else if (editors.isNotEmpty()) {
      lastEditors = editors.toList()
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

    val out = mutableMapOf<String, Any>(
      "editors" to editors,
      "diagnostics" to diagnostics.take(MAX_DIAGNOSTICS),
      "recentFiles" to recentFilePaths(project, openFiles, selectedFile),
    )
    if (selectedEditor != null) {
      enclosingSymbol(project, selectedEditor)?.let { out["enclosingSymbol"] = it }
    }
    terminalSnapshot(project)?.let { out["terminal"] = it }
    log.info(
      "Harbor ideContext editors=${editors.size} diags=${diagnostics.size} " +
        "symbol=${out.containsKey("enclosingSymbol")} terminal=${out.containsKey("terminal")} " +
        "active=${selectedFile?.path ?: "-"}",
    )
    return out
  }

  private fun resolveSelectedFile(fem: FileEditorManager): VirtualFile? {
    fem.selectedTextEditor?.let { ed ->
      FileDocumentManager.getInstance().getFile(ed.document)?.let { return it }
    }
    fem.selectedFiles.firstOrNull()?.let { return it }
    fem.selectedEditor?.file?.let { return it }
    return fem.openFiles.firstOrNull()
  }

  private fun resolveSelectedEditor(fem: FileEditorManager, file: VirtualFile?): Editor? {
    fem.selectedTextEditor?.let { return it }
    if (file != null) {
      fem.getEditors(file).filterIsInstance<TextEditor>().firstOrNull()?.editor?.let { return it }
    }
    (fem.selectedEditor as? TextEditor)?.editor?.let { return it }
    return fem.openFiles.firstNotNullOfOrNull { vf ->
      fem.getEditors(vf).filterIsInstance<TextEditor>().firstOrNull()?.editor
    }
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

  private fun enclosingSymbol(project: Project, editor: Editor): Map<String, Any>? {
    val psiFile = PsiDocumentManager.getInstance(project).getPsiFile(editor.document) ?: return null
    val offset = editor.caretModel.offset.coerceIn(0, editor.document.textLength)
    var el = psiFile.findElementAt(offset)
    var best: PsiNamedElement? = null
    while (el != null && el !is PsiFile) {
      if (el is PsiNamedElement) {
        val n = el.name
        if (!n.isNullOrBlank() && el.textLength in 40..20_000) {
          val prev = best
          if (prev == null || el.textLength <= prev.textLength) {
            best = el
          }
        }
      }
      el = el.parent
    }
    val named = best ?: return null
    val name = named.name ?: return null
    val start = named.textRange.startOffset.coerceIn(0, editor.document.textLength)
    val line = editor.document.getLineNumber(start)
    val firstLine = named.text.lineSequence().firstOrNull()?.trim().orEmpty().take(240)
    return mapOf(
      "name" to name,
      "kind" to named.javaClass.simpleName,
      "line" to line,
      "detail" to firstLine,
    )
  }

  private fun terminalSnapshot(project: Project): Map<String, Any>? {
    runConsoleSnapshot(project)?.let { return it }
    return ideTerminalSnapshot(project)
  }

  private fun runConsoleSnapshot(project: Project): Map<String, Any>? {
    return try {
      val content = RunContentManager.getInstance(project).selectedContent ?: return null
      val console = content.executionConsole ?: return null
      val editor = console.javaClass.methods
        .firstOrNull { it.name == "getEditor" && it.parameterCount == 0 }
        ?.invoke(console) as? Editor
      val text = editor?.document?.text?.takeLast(4000).orEmpty()
      if (text.isBlank()) return null
      mapOf(
        "name" to (content.displayName ?: "Run"),
        "output" to text,
      )
    } catch (_: Throwable) {
      null
    }
  }

  private fun ideTerminalSnapshot(project: Project): Map<String, Any>? {
    return try {
      val tw = ToolWindowManager.getInstance(project).getToolWindow("Terminal") ?: return null
      val content = tw.contentManager.selectedContent
        ?: tw.contentManager.contents.lastOrNull()
        ?: return null
      val text = extractTerminalText(content.component).trim()
      if (text.isBlank()) return null
      mapOf(
        "name" to (content.displayName ?: "Terminal"),
        "output" to text.takeLast(4000),
      )
    } catch (_: Throwable) {
      null
    }
  }

  private fun extractTerminalText(root: Component?): String {
    if (root == null) return ""
    val seen = IdentityHashSet()
    val queue = ArrayDeque<Any>()
    queue.add(root)
    var nodes = 0
    while (queue.isNotEmpty() && nodes < 48) {
      val cur = queue.removeFirst()
      if (!seen.add(cur)) continue
      nodes += 1
      val text = terminalTextFrom(cur)
      if (text.isNotBlank()) return text
      if (cur is Container) {
        for (child in cur.components) {
          queue.add(child)
        }
      }
      try {
        val preferred = cur.javaClass.methods.firstOrNull {
          it.parameterCount == 0 &&
            (it.name == "getTerminalWidget" ||
              it.name == "getTerminal" ||
              it.name == "getJediTermWidget" ||
              it.name == "getPreferredFocusableComponent")
        }
        preferred?.invoke(cur)?.let { queue.add(it) }
      } catch (_: Throwable) {
      }
    }
    return ""
  }

  private fun terminalTextFrom(obj: Any): String {
    val cls = obj.javaClass
    for (name in listOf("getText", "getTerminalText", "getContent")) {
      try {
        val m = cls.methods.firstOrNull { it.name == name && it.parameterCount == 0 } ?: continue
        val v = m.invoke(obj)
        if (v is String && v.isNotBlank() && v.length > 8) return v
      } catch (_: Throwable) {
      }
    }
    return try {
      val buf = cls.methods.firstOrNull {
        it.parameterCount == 0 && it.name.contains("TextBuffer", ignoreCase = true)
      }?.invoke(obj) ?: return ""
      val screen = buf.javaClass.methods.firstOrNull {
        it.parameterCount == 0 &&
          (it.name == "getScreenLines" || it.name == "getLines")
      }?.invoke(buf)
      when (screen) {
        is String -> screen
        is CharSequence -> screen.toString()
        else -> ""
      }
    } catch (_: Throwable) {
      ""
    }
  }

  private fun recentFilePaths(
    project: Project,
    openFiles: List<VirtualFile>,
    selected: VirtualFile?,
  ): List<String> {
    val ordered = LinkedHashSet<String>()
    selected?.path?.let { ordered.add(it) }
    try {
      val cls = Class.forName("com.intellij.openapi.fileEditor.impl.EditorHistoryManager")
      val inst = cls.getMethod("getInstance", Project::class.java).invoke(null, project)
      val files = try {
        cls.getMethod("getFiles").invoke(inst)
      } catch (_: Throwable) {
        cls.methods.firstOrNull { it.name == "getFileList" && it.parameterCount == 0 }?.invoke(inst)
      }
      when (files) {
        is Array<*> -> files.forEach { (it as? VirtualFile)?.path?.let(ordered::add) }
        is Iterable<*> -> files.forEach { (it as? VirtualFile)?.path?.let(ordered::add) }
      }
    } catch (_: Throwable) {
    }
    openFiles.forEach { ordered.add(it.path) }
    return ordered.take(MAX_OPEN_FILES).toList()
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

  private class IdentityHashSet {
    private val seen = java.util.IdentityHashMap<Any, Boolean>()
    fun add(value: Any): Boolean = seen.put(value, true) == null
  }
}
