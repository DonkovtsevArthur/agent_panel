package com.harbor.agents

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager

/**
 * Opens VS Code–parity settings **inside** the Harbor tool window (same JCEF).
 *
 * Native modal windows with a second/reparented JBCef are broken on macOS
 * (paint OK, mouse dead; reparent also resets OSR scale / looks like a theme flip).
 */
object HarborSettings {
  private val log = Logger.getInstance(HarborSettings::class.java)

  fun open(project: Project) {
    ApplicationManager.getApplication().invokeLater {
      try {
        if (!HarborJcef.isSupported()) {
          notify(project, "JCEF is unavailable — cannot open Harbor settings UI.")
          return@invokeLater
        }
        val tw = ToolWindowManager.getInstance(project).getToolWindow("Harbor Agents")
        if (tw != null) {
          tw.activate {
            ApplicationManager.getApplication().invokeLater {
              val panel = HarborProjectService.getInstance(project).toolWindowPanel()
              if (panel != null && panel.openSettingsSurface()) {
                return@invokeLater
              }
              notify(project, "Harbor panel is not ready yet. Open Harbor Agents, then Settings.")
            }
          }
          return@invokeLater
        }
        notify(project, "Harbor Agents tool window is missing.")
      } catch (t: Throwable) {
        log.warn("Harbor settings failed", t)
        notify(project, "Settings UI error: ${t.javaClass.simpleName}: ${t.message}")
      }
    }
  }

  fun close(project: Project) {
    ApplicationManager.getApplication().invokeLater {
      HarborProjectService.getInstance(project).toolWindowPanel()?.openChatSurface()
    }
  }

  private fun notify(project: Project, message: String) {
    try {
      NotificationGroupManager.getInstance()
        .getNotificationGroup("Harbor Agents")
        .createNotification(message, NotificationType.WARNING)
        .notify(project)
    } catch (_: Throwable) {
    }
  }
}
