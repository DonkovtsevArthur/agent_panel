package com.harbor.agents

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtil
import java.io.File

/**
 * After Node/Cline writes files via fs, refresh IntelliJ VFS so editors see changes.
 */
class HarborVfsRefreshService(private val project: Project) {
  private val log = Logger.getInstance(HarborVfsRefreshService::class.java)

  fun refresh(paths: List<String>) {
    if (paths.isEmpty()) {
      refreshProjectRoot()
      return
    }
    ApplicationManager.getApplication().invokeLater {
      val files = paths.mapNotNull { p ->
        LocalFileSystem.getInstance().refreshAndFindFileByIoFile(File(p))
      }.toTypedArray()
      if (files.isNotEmpty()) {
        LocalFileSystem.getInstance().refreshFiles(files.toList(), true, true, null)
        log.info("Harbor VFS refresh: ${files.size} path(s)")
      } else {
        refreshProjectRoot()
      }
    }
  }

  private fun refreshProjectRoot() {
    val base = project.basePath ?: return
    ApplicationManager.getApplication().invokeLater {
      val root = LocalFileSystem.getInstance().findFileByPath(base) ?: return@invokeLater
      VfsUtil.markDirtyAndRefresh(true, true, true, root)
    }
  }
}
