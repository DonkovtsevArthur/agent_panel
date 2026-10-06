package com.harbor.agents

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.intellij.ide.structureView.StructureViewTreeElement
import com.intellij.ide.structureView.TreeBasedStructureViewBuilder
import com.intellij.ide.util.treeView.smartTree.TreeElement
import com.intellij.lang.LanguageDocumentation
import com.intellij.lang.LanguageStructureViewBuilder
import com.intellij.navigation.ChooseByNameContributor
import com.intellij.navigation.ChooseByNameContributorEx
import com.intellij.navigation.NavigationItem
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtil
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiDocumentManager
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiManager
import com.intellij.psi.PsiNameIdentifierOwner
import com.intellij.psi.PsiNamedElement
import com.intellij.psi.PsiPolyVariantReference
import com.intellij.psi.PsiReference
import com.intellij.psi.SmartPointerManager
import com.intellij.psi.search.GlobalSearchScope
import com.intellij.psi.search.searches.DefinitionsScopedSearch
import com.intellij.psi.search.searches.ReferencesSearch
import com.intellij.psi.util.PsiTreeUtil
import com.intellij.refactoring.rename.RenameProcessor
import com.intellij.refactoring.rename.RenamePsiElementProcessor
import com.intellij.util.Processor
import com.intellij.util.concurrency.AppExecutorUtil
import com.intellij.util.indexing.FindSymbolParameters
import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * Host side of Harbor `code_nav` / `rename_symbol` for the Node sidecar
 * (see `src/codeNav.ts` → `createHostRpcCodeNavBackend`).
 *
 * Protocol: sidecar sends notification `host.ideRequest {requestId, op, params}`;
 * [HarborHostBridge] calls [handleAsync], which answers with the sidecar method
 * `ide.response {requestId, ok, result | error}`.
 *
 * Positions are 1-based line/column (UTF-16 columns, same as JS / VS Code).
 * Paths are absolute, system-dependent on the way out (Node `path` friendly).
 * Platform-only APIs (no Java PSI) so it works in WebStorm, Rider, PyCharm, …
 */
object HarborCodeNav {
  private val log = Logger.getInstance(HarborCodeNav::class.java)
  private val gson = Gson()
  private const val READ_TIMEOUT_MS = 18_000L
  private const val RENAME_TIMEOUT_MS = 85_000L
  private const val MAX_NAMES = 300

  /** Several bridges may listen to one sidecar — answer each request once. */
  private val handled = ConcurrentHashMap.newKeySet<String>()

  fun handleAsync(
    project: Project,
    sidecar: HarborSidecarProcess,
    params: JsonObject?,
  ) {
    val requestId = params?.get("requestId")?.asString.orEmpty()
    if (requestId.isEmpty()) return
    val key = "${System.identityHashCode(sidecar)}:$requestId"
    if (!handled.add(key)) return
    if (handled.size > 2_000) handled.clear()
    val op = params?.get("op")?.asString.orEmpty()
    val args = params?.get("params")?.takeIf { it.isJsonObject }?.asJsonObject ?: JsonObject()
    ApplicationManager.getApplication().executeOnPooledThread {
      val reply = JsonObject().apply { addProperty("requestId", requestId) }
      try {
        val result = handle(project, op, args)
        reply.addProperty("ok", true)
        reply.add("result", result)
      } catch (t: Throwable) {
        log.warn("Harbor code_nav $op failed", t)
        reply.addProperty("ok", false)
        reply.addProperty("error", (t.message ?: t.javaClass.simpleName).take(500))
      }
      sidecar.request("ide.response", reply) { _ -> }
    }
  }

  fun handle(project: Project, op: String, p: JsonObject): JsonElement {
    if (project.isDisposed) error("project is closed")
    return when (op) {
      "definition" -> gson.toJsonTree(definition(project, p))
      "references" -> gson.toJsonTree(references(project, p))
      "implementations" -> gson.toJsonTree(implementations(project, p))
      "hover" -> gson.toJsonTree(mapOf("text" to hover(project, p)))
      "workspaceSymbols" -> gson.toJsonTree(workspaceSymbols(project, p))
      "documentSymbols" -> gson.toJsonTree(documentSymbols(project, p))
      "rename" -> gson.toJsonTree(rename(project, p))
      else -> error("unknown code_nav op: $op")
    }
  }

  // ---------------------------------------------------------------------------
  // Plumbing
  // ---------------------------------------------------------------------------

  /** Smart-mode, documents-committed read action on a background thread. */
  private fun <T> read(project: Project, timeoutMs: Long = READ_TIMEOUT_MS, body: () -> T): T {
    val promise = ReadAction.nonBlocking(Callable { body() })
      .inSmartMode(project)
      .withDocumentsCommitted(project)
      .expireWith(project)
      .submit(AppExecutorUtil.getAppExecutorService())
    try {
      return promise.blockingGet(timeoutMs.toInt(), TimeUnit.MILLISECONDS)
        ?: error("IDE returned no result")
    } catch (e: java.util.concurrent.TimeoutException) {
      promise.cancel()
      error("timed out after ${timeoutMs / 1000}s (IDE still indexing?)")
    } catch (e: java.util.concurrent.ExecutionException) {
      throw e.cause ?: e
    }
  }

  /** Pick up files the agent just wrote via Node (VFS may be stale). Not under a read lock. */
  private fun refreshFile(path: String): VirtualFile {
    val independent = FileUtil.toSystemIndependentName(path)
    val lfs = LocalFileSystem.getInstance()
    val existing = lfs.findFileByPath(independent)
    if (existing != null && existing.isValid) {
      VfsUtil.markDirtyAndRefresh(false, false, false, existing)
      if (existing.isValid) return existing
    }
    return lfs.refreshAndFindFileByPath(independent) ?: error("file not found: $path")
  }

  private fun outPath(vf: VirtualFile): String = FileUtil.toSystemDependentName(vf.path)

  private data class At(val file: PsiFile, val document: Document, val offset: Int)

  private fun at(project: Project, vf: VirtualFile, p: JsonObject): At {
    val psiFile = PsiManager.getInstance(project).findFile(vf) ?: error("no PSI for ${vf.path}")
    val document = PsiDocumentManager.getInstance(project).getDocument(psiFile)
      ?: FileDocumentManager.getInstance().getDocument(vf)
      ?: error("no document for ${vf.path}")
    val line = ((p.get("line")?.asInt ?: 1) - 1).coerceIn(0, (document.lineCount - 1).coerceAtLeast(0))
    val lineStart = if (document.lineCount == 0) 0 else document.getLineStartOffset(line)
    val lineEnd = if (document.lineCount == 0) 0 else document.getLineEndOffset(line)
    val column = ((p.get("column")?.asInt ?: 1) - 1).coerceAtLeast(0)
    return At(psiFile, document, (lineStart + column).coerceIn(lineStart, lineEnd))
  }

  private fun location(project: Project, file: PsiFile?, offset: Int): Map<String, Any>? {
    val f = file ?: return null
    val vf = f.virtualFile ?: f.originalFile.virtualFile ?: return null
    if (!vf.isInLocalFileSystem) return null
    val document = PsiDocumentManager.getInstance(project).getDocument(f)
      ?: FileDocumentManager.getInstance().getDocument(vf)
      ?: return null
    val safe = offset.coerceIn(0, document.textLength)
    val line = document.getLineNumber(safe)
    return mapOf(
      "path" to outPath(vf),
      "line" to line + 1,
      "column" to (safe - document.getLineStartOffset(line)) + 1,
    )
  }

  private fun elementLocation(project: Project, element: PsiElement): Map<String, Any>? {
    val nav = element.navigationElement ?: element
    val offset = (nav as? PsiNameIdentifierOwner)?.nameIdentifier?.textRange?.startOffset
      ?: nav.textOffset
    return location(project, nav.containingFile, offset)
  }

  private fun referenceLocation(project: Project, ref: PsiReference): Map<String, Any>? {
    val el = ref.element
    val start = el.textRange?.startOffset ?: return null
    return location(project, el.containingFile, start + ref.rangeInElement.startOffset)
  }

  private fun resolveAll(ref: PsiReference): List<PsiElement> {
    if (ref is PsiPolyVariantReference) {
      val many = ref.multiResolve(false).mapNotNull { it.element }
      if (many.isNotEmpty()) return many
    }
    return listOfNotNull(ref.resolve())
  }

  /**
   * Import bindings (ES6 import specifiers, Python import elements, …) resolve
   * to the binding itself — follow up to two hops to the real declaration.
   */
  private fun throughImports(element: PsiElement): PsiElement {
    var current = element
    repeat(2) {
      if (!current.javaClass.simpleName.contains("Import", ignoreCase = true)) return current
      val next = current.references.asSequence().flatMap { resolveAll(it).asSequence() }
        .firstOrNull { it != current }
        ?: return current
      current = next
    }
    return current
  }

  /** Declarations for the identifier at the caret (reference target, or the declaration itself). */
  private fun targets(at: At): List<PsiElement> {
    val ref = at.file.findReferenceAt(at.offset)
      ?: if (at.offset > 0) at.file.findReferenceAt(at.offset - 1) else null
    if (ref != null) {
      val resolved = resolveAll(ref).map { throughImports(it) }.distinct()
      if (resolved.isNotEmpty()) return resolved
    }
    var el = at.file.findElementAt(at.offset)
    while (el != null && el !is PsiFile) {
      if (el is PsiNameIdentifierOwner) {
        val range = el.nameIdentifier?.textRange
        if (range != null && range.startOffset <= at.offset && at.offset <= range.endOffset) {
          return listOf(el)
        }
      }
      el = el.parent
    }
    val leaf = at.file.findElementAt(at.offset) ?: return emptyList()
    val named = PsiTreeUtil.getParentOfType(leaf, PsiNamedElement::class.java, false)
    return if (named != null && named !is PsiFile && named.name == leaf.text) listOf(named) else emptyList()
  }

  private fun projectScope(project: Project) = GlobalSearchScope.projectScope(project)

  private fun limitOf(p: JsonObject, default: Int, max: Int): Int =
    (p.get("limit")?.asInt ?: default).coerceIn(1, max)

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------

  private fun definition(project: Project, p: JsonObject): List<Map<String, Any>> {
    val vf = refreshFile(p.get("path").asString)
    return read(project) {
      targets(at(project, vf, p)).mapNotNull { elementLocation(project, it) }.distinct()
    }
  }

  private fun references(project: Project, p: JsonObject): List<Map<String, Any>> {
    val vf = refreshFile(p.get("path").asString)
    val limit = limitOf(p, 100, 1_000)
    return read(project) {
      val out = LinkedHashSet<Map<String, Any>>()
      for (target in targets(at(project, vf, p))) {
        ReferencesSearch.search(target, projectScope(project), false).forEach(
          Processor { ref ->
            referenceLocation(project, ref)?.let { out.add(it) }
            out.size < limit
          },
        )
        if (out.size >= limit) break
      }
      out.toList()
    }
  }

  private fun implementations(project: Project, p: JsonObject): List<Map<String, Any>> {
    val vf = refreshFile(p.get("path").asString)
    val limit = limitOf(p, 100, 1_000)
    return read(project) {
      val out = LinkedHashSet<Map<String, Any>>()
      for (target in targets(at(project, vf, p))) {
        DefinitionsScopedSearch.search(target, projectScope(project)).forEach(
          Processor { impl ->
            if (impl != target) elementLocation(project, impl)?.let { out.add(it) }
            out.size < limit
          },
        )
        if (out.size >= limit) break
      }
      out.toList()
    }
  }

  private fun hover(project: Project, p: JsonObject): String {
    val vf = refreshFile(p.get("path").asString)
    return read(project) {
      val at = at(project, vf, p)
      val target = targets(at).firstOrNull() ?: return@read ""
      val original = at.file.findElementAt(at.offset)
      val provider = LanguageDocumentation.INSTANCE.forLanguage(target.language)
        ?: LanguageDocumentation.INSTANCE.forLanguage(at.file.language)
      val quick = runCatching { provider?.getQuickNavigateInfo(target, original) }.getOrNull()
      val doc = runCatching { provider?.generateDoc(target, original) }.getOrNull()
      val parts = listOfNotNull(
        quick?.takeIf { it.isNotBlank() },
        doc?.takeIf { it.isNotBlank() }?.take(6_000),
      )
      if (parts.isEmpty()) {
        // No documentation provider: at least show the declaration text.
        val nav = target.navigationElement ?: target
        nav.text?.lineSequence()?.take(6)?.joinToString("\n").orEmpty()
      } else {
        parts.joinToString("\n\n")
      }
    }
  }

  private fun matchRank(name: String, query: String): Int {
    val n = name.lowercase()
    val q = query.lowercase()
    return when {
      name == query -> 0
      n == q -> 1
      n.startsWith(q) -> 2
      n.contains(q) -> 3
      else -> -1
    }
  }

  private fun workspaceSymbols(project: Project, p: JsonObject): List<Map<String, Any>> {
    val query = p.get("query")?.asString?.trim().orEmpty()
    if (query.isEmpty()) return emptyList()
    val limit = limitOf(p, 30, 200)
    return read(project) {
      val scope = projectScope(project)
      val contributors = (
        ChooseByNameContributor.CLASS_EP_NAME.extensionList +
          ChooseByNameContributor.SYMBOL_EP_NAME.extensionList
        ).distinct()
      val names = LinkedHashSet<String>()
      for (c in contributors) {
        runCatching {
          if (c is ChooseByNameContributorEx) {
            c.processNames(
              Processor { n ->
                if (matchRank(n, query) >= 0) names.add(n)
                names.size < MAX_NAMES
              },
              scope,
              null,
            )
          } else {
            for (n in c.getNames(project, false)) {
              if (matchRank(n, query) >= 0) names.add(n)
              if (names.size >= MAX_NAMES) break
            }
          }
        }
      }
      val ranked = names.sortedWith(compareBy({ matchRank(it, query) }, { it.length }))
      val out = LinkedHashMap<String, Map<String, Any>>()
      for (name in ranked) {
        for (c in contributors) {
          val items = mutableListOf<NavigationItem>()
          runCatching {
            if (c is ChooseByNameContributorEx) {
              c.processElementsWithName(
                name,
                Processor { item ->
                  items.add(item)
                  items.size < limit
                },
                FindSymbolParameters.wrap(name, project, false),
              )
            } else {
              items.addAll(c.getItemsByName(name, query, project, false))
            }
          }
          for (item in items) {
            val element = item as? PsiElement ?: continue
            val loc = elementLocation(project, element) ?: continue
            val key = "${loc["path"]}:${loc["line"]}:${item.name}"
            if (out.containsKey(key)) continue
            val row = LinkedHashMap<String, Any>(loc)
            row["name"] = item.name ?: name
            kindOf(element)?.let { row["kind"] = it }
            item.presentation?.locationString?.takeIf { it.isNotBlank() }?.let {
              row["container"] = it.trim().removePrefix("(").removeSuffix(")")
            }
            out[key] = row
            if (out.size >= limit) return@read out.values.toList()
          }
        }
      }
      out.values.toList()
    }
  }

  private fun kindOf(element: Any?): String? {
    val n = element?.javaClass?.simpleName ?: return null
    return when {
      n.contains("Interface") -> "Interface"
      n.contains("Enum") -> "Enum"
      n.contains("Class") -> "Class"
      n.contains("TypeAlias") -> "Type"
      n.contains("Method") -> "Method"
      n.contains("Constructor") -> "Constructor"
      n.contains("Function") -> "Function"
      n.contains("Property") || n.contains("Field") -> "Property"
      n.contains("Variable") || n.contains("Parameter") -> "Variable"
      n.contains("Namespace") || n.contains("Module") -> "Module"
      else -> null
    }
  }

  private fun documentSymbols(project: Project, p: JsonObject): List<Map<String, Any>> {
    val vf = refreshFile(p.get("path").asString)
    return read(project) {
      val psiFile = PsiManager.getInstance(project).findFile(vf) ?: error("no PSI for ${vf.path}")
      val viaStructure = runCatching { structureOutline(project, psiFile) }.getOrNull()
      if (!viaStructure.isNullOrEmpty()) viaStructure else genericOutline(project, psiFile)
    }
  }

  /** The same tree as the Structure tool window. */
  private fun structureOutline(project: Project, psiFile: PsiFile): List<Map<String, Any>> {
    val builder = LanguageStructureViewBuilder.getInstance().getStructureViewBuilder(psiFile)
      as? TreeBasedStructureViewBuilder ?: return emptyList()
    val model = builder.createStructureViewModel(null)
    val out = mutableListOf<Map<String, Any>>()
    try {
      fun walk(node: TreeElement, depth: Int) {
        if (out.size >= 800 || depth > 8) return
        val value = (node as? StructureViewTreeElement)?.value
        val element = value as? PsiElement
        val name = node.presentation.presentableText?.trim().orEmpty()
        if (element != null && name.isNotEmpty()) {
          val loc = elementLocation(project, element)
          if (loc != null) {
            val row = LinkedHashMap<String, Any>(loc)
            row["name"] = name
            row["depth"] = depth
            kindOf(element)?.let { row["kind"] = it }
            out.add(row)
          }
        }
        for (child in node.children) walk(child, depth + 1)
      }
      for (child in model.root.children) walk(child, 0)
    } finally {
      Disposer.dispose(model)
    }
    return out
  }

  /** Fallback when a language has no structure view: named declarations by nesting. */
  private fun genericOutline(project: Project, psiFile: PsiFile): List<Map<String, Any>> {
    val out = mutableListOf<Map<String, Any>>()
    fun walk(element: PsiElement, depth: Int) {
      for (child in element.children) {
        if (out.size >= 800) return
        if (child is PsiNameIdentifierOwner && !child.name.isNullOrBlank()) {
          elementLocation(project, child)?.let { loc ->
            val row = LinkedHashMap<String, Any>(loc)
            row["name"] = child.name!!
            row["depth"] = depth
            kindOf(child)?.let { row["kind"] = it }
            out.add(row)
          }
          if (depth < 4) walk(child, depth + 1)
        } else {
          walk(child, depth)
        }
      }
    }
    walk(psiFile, 0)
    return out
  }

  private fun rename(project: Project, p: JsonObject): Map<String, Any> {
    val newName = p.get("newName")?.asString?.trim().orEmpty()
    if (newName.isEmpty()) error("newName is empty")
    val vf = refreshFile(p.get("path").asString)
    data class Prepared(
      val pointer: com.intellij.psi.SmartPsiElementPointer<PsiElement>,
      val usages: Int,
      val files: List<String>,
    )
    val prepared = read(project) {
      val target = targets(at(project, vf, p)).firstOrNull() ?: error("no renamable symbol at that position")
      // Some processors may want UI here (e.g. "rename base method?") — keep the original then.
      val substituted = try {
        RenamePsiElementProcessor.forElement(target).substituteElementToRename(target, null)
          ?: error("rename cancelled for this element")
      } catch (e: IllegalStateException) {
        throw e
      } catch (t: Throwable) {
        target
      }
      if (!substituted.isWritable) error("symbol is declared in a read-only / library file")
      val refs = ReferencesSearch.search(substituted, projectScope(project), false).findAll()
      val files = LinkedHashSet<String>()
      (substituted.navigationElement ?: substituted).containingFile?.virtualFile?.let { files.add(outPath(it)) }
      for (ref in refs) ref.element.containingFile?.virtualFile?.let { files.add(outPath(it)) }
      Prepared(
        SmartPointerManager.getInstance(project).createSmartPsiElementPointer(substituted),
        refs.size,
        files.toList(),
      )
    }
    val app = ApplicationManager.getApplication()
    var changed: List<String> = emptyList()
    var renamed = false
    var failure: Throwable? = null
    app.invokeAndWait(
      {
        try {
          val element = prepared.pointer.element ?: error("symbol is no longer valid")
          val fdm = FileDocumentManager.getInstance()
          val before = fdm.unsavedDocuments.toSet()
          val processor = RenameProcessor(project, element, newName, false, false)
          processor.setPreviewUsages(false)
          processor.run()
          // Conflicts dialog cancelled by the user → name unchanged.
          renamed = (prepared.pointer.element as? PsiNamedElement)?.name == newName
          val touched = fdm.unsavedDocuments.filter { it !in before }
          changed = touched.mapNotNull { fdm.getFile(it) }.map { outPath(it) }
          // Persist so the sidecar (git, run_commands, read_files) sees the result.
          fdm.saveAllDocuments()
        } catch (t: Throwable) {
          failure = t
        }
      },
      ModalityState.defaultModalityState(),
    )
    failure?.let { throw it }
    // Documents that were already unsaved before the rename are not in `changed`;
    // fall back to the usage files found up front.
    if (!renamed && changed.isEmpty()) return mapOf("files" to emptyList<String>(), "edits" to 0)
    val files = changed.ifEmpty { prepared.files }
    return mapOf("files" to files, "edits" to (prepared.usages + 1))
  }
}
