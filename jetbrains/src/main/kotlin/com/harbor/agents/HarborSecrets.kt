package com.harbor.agents

import com.intellij.openapi.project.Project
import java.io.File
import java.util.Properties
import java.util.concurrent.ConcurrentHashMap

/**
 * Simple secrets store for Harbor JetBrains MVP.
 * Persists to `<workspace>/.idea/harbor/secrets.properties` (gitignored via .idea).
 * Avoids IntelliJ credentialStore API differences across platform versions.
 */
object HarborSecrets {
  private val memory = ConcurrentHashMap<String, String>()

  private fun secretsFile(project: Project?): File? {
    val base = project?.basePath ?: return null
    return File(base, ".idea/harbor/secrets.properties")
  }

  private fun load(project: Project?): Properties {
    val props = Properties()
    val file = secretsFile(project) ?: return props
    if (file.exists()) {
      file.inputStream().use { props.load(it) }
    }
    return props
  }

  private fun save(project: Project?, props: Properties) {
    val file = secretsFile(project) ?: return
    file.parentFile?.mkdirs()
    file.outputStream().use { props.store(it, "Harbor Agents secrets (local)") }
  }

  fun get(key: String, project: Project? = null): String? {
    memory[key]?.let { return it }
    val fromFile = load(project).getProperty(key)
    if (fromFile != null) {
      memory[key] = fromFile
    }
    return fromFile
  }

  fun set(key: String, value: String, project: Project? = null) {
    memory[key] = value
    val props = load(project)
    props.setProperty(key, value)
    save(project, props)
  }

  fun delete(key: String, project: Project? = null) {
    memory.remove(key)
    val props = load(project)
    props.remove(key)
    save(project, props)
  }

  fun figmaPatKey(project: Project): String =
    "figma.pat.${project.locationHash}"
}
