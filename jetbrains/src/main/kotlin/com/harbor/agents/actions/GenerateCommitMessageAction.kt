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
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.vcs.CommitMessageI
import com.intellij.openapi.vcs.VcsDataKeys
import com.intellij.openapi.vcs.changes.Change
import com.intellij.openapi.vcs.changes.ChangeListManager
import java.awt.datatransfer.StringSelection
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Generate a commit message via Harbor sidecar (same LLM path as VS Code)
 * and write it into the VCS commit message field.
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
    val commitControl = e.getData(VcsDataKeys.COMMIT_MESSAGE_CONTROL) as? CommitMessageI
    val paths = resolveRelativePaths(e, project)
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
              addProperty("cwd", project.basePath ?: "")
              val arr = JsonArray()
              paths.forEach { arr.add(it) }
              add("paths", arr)
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

    private fun resolveRelativePaths(e: AnActionEvent, project: Project): List<String> {
      val base = project.basePath?.replace('\\', '/') ?: return emptyList()
      val prefix = if (base.endsWith("/")) base else "$base/"
      val selected = e.getData(VcsDataKeys.CHANGES)
      val changes: Collection<Change> =
        if (selected != null && selected.isNotEmpty()) {
          selected.toList()
        } else {
          ChangeListManager.getInstance(project).defaultChangeList.changes
        }
      val out = linkedSetOf<String>()
      for (change in changes) {
        val vf =
          change.afterRevision?.file?.virtualFile
            ?: change.beforeRevision?.file?.virtualFile
            ?: change.virtualFile
        if (vf != null) {
          val abs = vf.path.replace('\\', '/')
          if (abs.startsWith(prefix)) {
            out.add(abs.removePrefix(prefix))
          } else {
            out.add(vf.name)
          }
          continue
        }
        val io =
          change.afterRevision?.file?.ioFile
            ?: change.beforeRevision?.file?.ioFile
        if (io != null) {
          val abs = io.absolutePath.replace('\\', '/')
          if (abs.startsWith(prefix)) {
            out.add(abs.removePrefix(prefix))
          } else {
            out.add(io.name)
          }
        }
      }
      return out.toList()
    }
  }
}
