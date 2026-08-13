package com.harbor.agents

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.extensions.PluginId
import java.nio.file.Path

object HarborPluginInfo {
  const val ID = "com.harbor.agents"

  fun version(): String {
    return try {
      PluginManagerCore.getPlugin(PluginId.getId(ID))?.version?.trim().orEmpty()
        .ifBlank { "dev" }
    } catch (_: Throwable) {
      "dev"
    }
  }

  fun pluginPath(): Path? {
    return try {
      PluginManagerCore.getPlugin(PluginId.getId(ID))?.pluginPath
    } catch (_: Throwable) {
      null
    }
  }

  fun devOverlay(): Boolean = System.getenv("HARBOR_DEV") == "1"
}
