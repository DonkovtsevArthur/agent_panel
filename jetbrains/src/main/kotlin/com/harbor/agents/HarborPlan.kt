package com.harbor.agents

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.io.File

/**
 * Plan.md / План.md under `.idea/harbor/` — mirrors VS Code
 * [agentPanelProvider.openPlanMarkdown] + live text for Build.
 */
object HarborPlan {
  private val WRAPPER_RE =
    Regex(
      """(?:<proposed_plan>|&lt;proposed_plan&gt;)\s*([\s\S]*?)(?:</proposed_plan>|&lt;/proposed_plan&gt;)""",
      RegexOption.IGNORE_CASE,
    )

  fun stripWrapper(raw: String?): String {
    val text = raw?.trim().orEmpty()
    if (text.isEmpty()) {
      return ""
    }
    val m = WRAPPER_RE.find(text)
    return (m?.groupValues?.getOrNull(1) ?: text).trim()
  }

  private fun harborDir(project: Project): File {
    val base = project.basePath ?: System.getProperty("user.home")
    return File(base, ".idea/harbor").also { it.mkdirs() }
  }

  private fun preferredLang(project: Project): String {
    return try {
      val f = File(harborDir(project), "settings.json")
      if (!f.isFile) {
        return "en"
      }
      val m = Regex(""""language"\s*:\s*"(ru|en)"""").find(f.readText())
      m?.groupValues?.getOrNull(1) ?: "en"
    } catch (_: Exception) {
      "en"
    }
  }

  fun planFile(project: Project): File {
    val name = if (preferredLang(project) == "ru") "План.md" else "Plan.md"
    return File(harborDir(project), name)
  }

  fun writeAndOpen(
    project: Project,
    markdown: String?,
    @Suppress("UNUSED_PARAMETER") reveal: String = "editor",
  ) {
    val content = stripWrapper(markdown)
    if (content.isBlank()) {
      return
    }
    val file = planFile(project)
    file.writeText(content)
    // Keep both names in sync so Build can find either.
    val alt =
      File(
        harborDir(project),
        if (file.name == "План.md") "Plan.md" else "План.md",
      )
    try {
      alt.writeText(content)
    } catch (_: Exception) {
    }

    ApplicationManager.getApplication().invokeLater {
      val vf =
        LocalFileSystem.getInstance().refreshAndFindFileByIoFile(file)
          ?: return@invokeLater
      FileEditorManager.getInstance(project).openFile(vf, true)
      // Preview: open editor is enough; Markdown plugin may show split preview.
      // Explicit preview actions vary by IDE build — avoid brittle ActionManager IDs.
    }
  }

  /** Prefer open editor buffer, else disk Plan.md / План.md. */
  fun readLive(project: Project): String {
    val names = setOf("Plan.md", "План.md")
    val fem = FileEditorManager.getInstance(project)
    for (vf in fem.openFiles) {
      if (vf.name in names) {
        val doc = FileDocumentManager.getInstance().getDocument(vf)
        if (doc != null) {
          val t = stripWrapper(doc.text)
          if (t.isNotBlank()) {
            return t
          }
        }
      }
    }
    for (name in names) {
      val f = File(harborDir(project), name)
      if (f.isFile) {
        val t = stripWrapper(f.readText())
        if (t.isNotBlank()) {
          return t
        }
      }
    }
    return ""
  }
}
