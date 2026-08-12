package com.harbor.agents

import com.intellij.openapi.project.Project
import java.io.File
import java.util.Locale

/** Resolve Harbor panel UI language from `.idea/harbor/settings.json` or IDE locale. */
object HarborUiLanguage {
  fun resolve(project: Project?): String {
    val fromSettings = readSetting(project)
    return when (fromSettings) {
      "ru", "en" -> fromSettings
      else -> ideLocale()
    }
  }

  fun ideLocale(): String =
    if (Locale.getDefault().language.startsWith("ru")) "ru" else "en"

  private fun readSetting(project: Project?): String? {
    if (project == null) {
      return null
    }
    return try {
      val base = project.basePath ?: return null
      val f = File(base, ".idea/harbor/settings.json")
      if (!f.isFile) {
        return null
      }
      val text = f.readText()
      // Prefer nested agentPanel.language, then top-level language.
      val nested =
        Regex(""""agentPanel"\s*:\s*\{[\s\S]*?"language"\s*:\s*"(auto|ru|en)"""")
          .find(text)
          ?.groupValues
          ?.getOrNull(1)
      val top =
        Regex(""""language"\s*:\s*"(auto|ru|en)"""")
          .find(text)
          ?.groupValues
          ?.getOrNull(1)
      when (val raw = nested ?: top) {
        "ru", "en", "auto" -> raw
        else -> null
      }
    } catch (_: Exception) {
      null
    }
  }
}
