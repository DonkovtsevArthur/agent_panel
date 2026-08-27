package com.harbor.agents.actions

import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.harbor.agents.HarborProjectService
import com.harbor.agents.HarborUiLanguage
import com.intellij.ide.ActivityTracker
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vcs.CommitMessageI
import com.intellij.openapi.vcs.FilePath
import com.intellij.openapi.vcs.ProjectLevelVcsManager
import com.intellij.openapi.vcs.VcsDataKeys
import com.intellij.openapi.vcs.changes.Change
import com.intellij.openapi.vcs.changes.ChangeListManager
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import java.awt.datatransfer.StringSelection
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Generate a commit message via Harbor sidecar (same LLM path as VS Code)
 * and write it into the VCS commit message field.
 *
 * Rider / IntelliJ 2025 non-modal Commit UI often has no [VcsDataKeys.CHANGES]
 * on the message-field action context; use [COMMIT_WORKFLOW_HANDLER] included
 * changes, save documents first so disk matches the IDE, and pass the git root
 * (not only [Project.getBasePath]) so sidecar `git diff` is non-empty.
 */
class GenerateCommitMessageAction : AnAction(), DumbAware {
  @Volatile private var running = false

  private val harborIcon by lazy {
    IconLoader.getIcon("/icons/harbor.svg", GenerateCommitMessageAction::class.java)
  }

  override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

  override fun update(e: AnActionEvent) {
    val p = e.presentation
    p.icon = harborIcon
    if (running) {
      p.isEnabled = false
      p.isVisible = true
      return
    }
    p.isEnabledAndVisible = e.project != null
  }

  override fun actionPerformed(e: AnActionEvent) {
    val project = e.project ?: return
    if (running) {
      return
    }
    // Commit UI can show dirty buffers that are not yet on disk; sidecar reads git.
    FileDocumentManager.getInstance().saveAllDocuments()

    val commitControl = e.getData(VcsDataKeys.COMMIT_MESSAGE_CONTROL) as? CommitMessageI
    val gitRoot = resolveGitRoot(project)
    val ctx = collectCommitContext(e, project, gitRoot)
    val lang = HarborUiLanguage.resolve(project)
    val title =
      if (lang == "ru") "Harbor: генерация сообщения коммита…"
      else "Harbor: generating commit message…"

    running = true
    ActivityTracker.getInstance().inc()

    object : Task.Backgroundable(project, title, true) {
      private var message: String? = null
      private var error: String? = null

      override fun run(indicator: ProgressIndicator) {
        indicator.isIndeterminate = true
        indicator.text =
          if (lang == "ru") "Запрос к модели…" else "Calling model…"
        try {
          val sidecar = HarborProjectService.getInstance(project).getOrCreateSidecar()
          val params =
            JsonObject().apply {
              addProperty("cwd", gitRoot.ifBlank { project.basePath ?: "" })
              val arr = JsonArray()
              ctx.paths.forEach { arr.add(it) }
              add("paths", arr)
              if (ctx.ideDiff.isNotBlank()) {
                addProperty("diff", ctx.ideDiff)
              }
            }
          val future = CompletableFuture<JsonElement?>()
          sidecar.request("commit.message", params) { el ->
            if (!future.isDone) {
              future.complete(el)
            }
          }

          val deadlineNs = System.nanoTime() + TimeUnit.SECONDS.toNanos(REQUEST_TIMEOUT_SEC)
          var result: JsonElement? = null
          while (true) {
            if (indicator.isCanceled) {
              future.complete(null)
              throw ProcessCanceledException()
            }
            val remainingMs =
              TimeUnit.NANOSECONDS.toMillis(deadlineNs - System.nanoTime())
            if (remainingMs <= 0) {
              future.complete(null)
              throw TimeoutException("commit.message timed out")
            }
            try {
              result = future.get(minOf(400L, remainingMs), TimeUnit.MILLISECONDS)
              break
            } catch (_: TimeoutException) {
              // keep polling so cancel / overall timeout work
            }
          }

          if (result == null || !result.isJsonObject) {
            error =
              if (lang == "ru") "Пустой ответ sidecar (проверьте Node / Harbor Settings)."
              else "Empty sidecar response (check Node / Harbor Settings)."
            return
          }
          val obj = result.asJsonObject
          val ok = obj.get("ok")?.asBoolean == true
          val text = obj.get("message")?.asString?.trim().orEmpty()
          if (!ok || text.isEmpty()) {
            error =
              obj.get("error")?.asString?.ifBlank { null }
                ?: if (lang == "ru") "Нет изменений для коммита или модель вернула пустой текст."
                else "No changes to commit, or the model returned an empty message."
            return
          }
          message = text
        } catch (_: ProcessCanceledException) {
          error =
            if (lang == "ru") "Генерация отменена."
            else "Generation cancelled."
        } catch (t: TimeoutException) {
          error =
            if (lang == "ru") "Таймаут генерации (${REQUEST_TIMEOUT_SEC}с). Проверьте API / сеть."
            else "Generation timed out (${REQUEST_TIMEOUT_SEC}s). Check API / network."
        } catch (t: Throwable) {
          error = t.message ?: t.toString()
        }
      }

      override fun onSuccess() {
        finishUi(project, lang, commitControl, message, error)
      }

      override fun onCancel() {
        finishUi(
          project,
          lang,
          commitControl,
          null,
          if (lang == "ru") "Генерация отменена." else "Generation cancelled.",
        )
      }

      override fun onThrowable(error: Throwable) {
        finishUi(project, lang, commitControl, null, error.message ?: error.toString())
      }

      override fun onFinished() {
        running = false
        ActivityTracker.getInstance().inc()
      }
    }.queue()
  }

  private fun finishUi(
    project: Project,
    lang: String,
    commitControl: CommitMessageI?,
    text: String?,
    err: String?,
  ) {
    if (err != null) {
      // Cancel is not a hard error toast noise if user cancelled — still notify briefly.
      notify(project, err, NotificationType.WARNING)
      return
    }
    if (text.isNullOrBlank()) {
      notify(
        project,
        if (lang == "ru") "Пустое сообщение коммита." else "Empty commit message.",
        NotificationType.WARNING,
      )
      return
    }
    ApplicationManager.getApplication().invokeLater {
      if (commitControl != null) {
        commitControl.setCommitMessage(text)
      } else {
        CopyPasteManager.getInstance().setContents(StringSelection(text))
        notify(
          project,
          if (lang == "ru")
            "Сообщение коммита скопировано в буфер. Вставьте в Commit."
          else
            "Commit message copied to clipboard. Paste it into Commit.",
          NotificationType.INFORMATION,
        )
      }
    }
  }

  private fun notify(project: Project, text: String, type: NotificationType) {
    NotificationGroupManager.getInstance()
      .getNotificationGroup("Harbor Agents")
      .createNotification(text, type)
      .notify(project)
  }

  companion object {
    private const val REQUEST_TIMEOUT_SEC = 60L
    private const val MAX_IDE_DIFF_CHARS = 90_000

    data class CommitContext(val paths: List<String>, val ideDiff: String)

    /** Prefer VCS mapping / .git walk-up over Project.basePath (Rider solution folder). */
    fun resolveGitRoot(project: Project): String {
      val base = project.basePath?.trim().orEmpty()
      if (base.isEmpty()) {
        return ""
      }
      val vcsMgr = ProjectLevelVcsManager.getInstance(project)
      val baseVf = LocalFileSystem.getInstance().findFileByPath(base)
      if (baseVf != null) {
        val mapped = vcsMgr.getVcsRootFor(baseVf)
        if (mapped != null) {
          return mapped.path.replace('\\', '/')
        }
      }
      for (root in vcsMgr.allVersionedRoots) {
        val p = root.path.replace('\\', '/')
        if (FileUtil.isAncestor(File(p), File(base), false) ||
          FileUtil.isAncestor(File(base), File(p), false)
        ) {
          return p
        }
      }
      var dir: File? = File(base)
      while (dir != null) {
        val git = File(dir, ".git")
        if (git.exists()) {
          return dir.absolutePath.replace('\\', '/')
        }
        dir = dir.parentFile
      }
      return base.replace('\\', '/')
    }

    fun collectCommitContext(
      e: AnActionEvent,
      project: Project,
      gitRoot: String,
    ): CommitContext {
      val root =
        gitRoot.ifBlank { project.basePath?.replace('\\', '/') ?: return CommitContext(emptyList(), "") }
          .replace('\\', '/')
      val changes = linkedSetOf<Change>()
      val unversioned = linkedSetOf<VirtualFile>()

      collectFromCommitWorkflow(e, changes, unversioned)

      if (changes.isEmpty()) {
        val selected =
          e.getData(VcsDataKeys.SELECTED_CHANGES)
            ?: e.getData(VcsDataKeys.CHANGES)
        if (selected != null && selected.isNotEmpty()) {
          changes.addAll(selected)
        }
      }

      if (changes.isEmpty() && unversioned.isEmpty()) {
        changes.addAll(ChangeListManager.getInstance(project).defaultChangeList.changes)
      }

      if (changes.isEmpty() && unversioned.isEmpty()) {
        for (list in ChangeListManager.getInstance(project).changeLists) {
          changes.addAll(list.changes)
        }
      }

      val paths = linkedSetOf<String>()
      for (change in changes) {
        relPathForChange(change, root)?.let { paths.add(it) }
      }
      for (vf in unversioned) {
        relPathForVirtualFile(vf, root)?.let { paths.add(it) }
      }

      val ideDiff =
        ApplicationManager.getApplication().runReadAction<String> {
          buildIdeDiff(changes, unversioned, root)
        }
      return CommitContext(paths.toList(), ideDiff)
    }

    /**
     * Build a text snapshot from IDE Change content so generation works even when
     * `git diff` on disk is empty (unsaved timing, wrong cwd, Rider-only buffer state).
     */
    private fun buildIdeDiff(
      changes: Collection<Change>,
      unversioned: Collection<VirtualFile>,
      gitRoot: String,
    ): String {
      val sb = StringBuilder()
      for (change in changes) {
        if (sb.length >= MAX_IDE_DIFF_CHARS) {
          break
        }
        val path = relPathForChange(change, gitRoot) ?: "unknown"
        val before = revisionText(change.beforeRevision)
        val after = revisionText(change.afterRevision)
        if (before.isEmpty() && after.isEmpty()) {
          continue
        }
        sb.append("# file: ").append(path).append('\n')
        sb.append("## before\n").append(capBlock(before)).append('\n')
        sb.append("## after\n").append(capBlock(after)).append("\n\n")
      }
      for (vf in unversioned) {
        if (sb.length >= MAX_IDE_DIFF_CHARS) {
          break
        }
        if (vf.isDirectory) {
          continue
        }
        val path = relPathForVirtualFile(vf, gitRoot) ?: vf.name
        val text =
          try {
            String(vf.contentsToByteArray(), Charsets.UTF_8)
          } catch (_: Throwable) {
            continue
          }
        if (text.isEmpty()) {
          continue
        }
        sb.append("# file: ").append(path).append(" (untracked)\n")
        sb.append("## before\n\n## after\n").append(capBlock(text)).append("\n\n")
      }
      val out = sb.toString().trim()
      return if (out.length <= MAX_IDE_DIFF_CHARS) {
        out
      } else {
        out.take(MAX_IDE_DIFF_CHARS) + "\n\n[diff truncated]"
      }
    }

    private fun revisionText(revision: com.intellij.openapi.vcs.changes.ContentRevision?): String {
      if (revision == null) {
        return ""
      }
      return try {
        revision.content ?: ""
      } catch (_: Throwable) {
        ""
      }
    }

    private fun capBlock(text: String, max: Int = 24_000): String {
      if (text.length <= max) {
        return text
      }
      return text.take(max) + "\n…[truncated]"
    }

    /**
     * Prefer included (checked) changes from CommitWorkflowHandler.ui.
     * Reflection keeps us free of vcs-impl compile dependency.
     */
    @Suppress("UNCHECKED_CAST")
    private fun collectFromCommitWorkflow(
      e: AnActionEvent,
      changes: MutableSet<Change>,
      unversioned: MutableSet<VirtualFile>,
    ) {
      val handler = e.getData(VcsDataKeys.COMMIT_WORKFLOW_HANDLER) ?: return
      try {
        val ui =
          handler.javaClass.methods
            .firstOrNull { it.name == "getUi" && it.parameterCount == 0 }
            ?.invoke(handler)
            ?: return
        val includedChanges =
          ui.javaClass.methods
            .firstOrNull { it.name == "getIncludedChanges" && it.parameterCount == 0 }
            ?.invoke(ui) as? Collection<*>
        if (includedChanges != null) {
          for (item in includedChanges) {
            if (item is Change) {
              changes.add(item)
            }
          }
        }
        val includedUnversioned =
          ui.javaClass.methods
            .firstOrNull {
              it.name == "getIncludedUnversionedFiles" && it.parameterCount == 0
            }
            ?.invoke(ui) as? Collection<*>
        if (includedUnversioned != null) {
          for (item in includedUnversioned) {
            when (item) {
              is FilePath -> addUnversioned(item, unversioned)
              is VirtualFile -> unversioned.add(item)
            }
          }
        }
      } catch (_: Throwable) {
        // API drift — fall through to selection / changelist
      }
    }

    private fun addUnversioned(fp: FilePath, sink: MutableSet<VirtualFile>) {
      val vf = fp.virtualFile
      if (vf != null) {
        sink.add(vf)
        return
      }
      val io = fp.ioFile
      val found = LocalFileSystem.getInstance().findFileByIoFile(io)
      if (found != null) {
        sink.add(found)
      }
    }

    private fun relPathForChange(change: Change, gitRoot: String): String? {
      val vf =
        change.afterRevision?.file?.virtualFile
          ?: change.beforeRevision?.file?.virtualFile
          ?: change.virtualFile
      if (vf != null) {
        return relPathForVirtualFile(vf, gitRoot)
      }
      val fp =
        change.afterRevision?.file
          ?: change.beforeRevision?.file
          ?: return null
      return relPathForAbs(fp.path.replace('\\', '/'), gitRoot)
        ?: relPathForAbs(fp.ioFile.absolutePath.replace('\\', '/'), gitRoot)
    }

    private fun relPathForVirtualFile(vf: VirtualFile, gitRoot: String): String? {
      return relPathForAbs(vf.path.replace('\\', '/'), gitRoot)
    }

    /**
     * Paths relative to the git root. Case-insensitive ancestor check (macOS).
     * Never fall back to basename-only — that yields empty `git diff -- name`.
     */
    private fun relPathForAbs(abs: String, gitRoot: String): String? {
      if (abs.isBlank() || gitRoot.isBlank()) {
        return null
      }
      val rootFile = File(gitRoot)
      val absFile = File(abs)
      if (!FileUtil.isAncestor(rootFile, absFile, false)) {
        return null
      }
      val rel = FileUtil.getRelativePath(rootFile, absFile) ?: return null
      return rel.replace('\\', '/').trimStart('/')
    }
  }
}
