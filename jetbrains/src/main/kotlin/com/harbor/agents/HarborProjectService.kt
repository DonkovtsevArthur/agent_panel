package com.harbor.agents

import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import java.util.concurrent.atomic.AtomicReference

/**
 * Project-scoped Harbor services (shared sidecar for chat + settings webviews).
 */
@Service(Service.Level.PROJECT)
class HarborProjectService(private val project: Project) {
  private val log = Logger.getInstance(HarborProjectService::class.java)
  private val sidecarRef = AtomicReference<HarborSidecarProcess?>(null)
  private val panelRef = AtomicReference<HarborToolWindowPanel?>(null)

  fun workspaceRoot(): String = project.basePath ?: System.getProperty("user.home")

  fun registerToolWindowPanel(panel: HarborToolWindowPanel) {
    panelRef.set(panel)
  }

  fun unregisterToolWindowPanel(panel: HarborToolWindowPanel) {
    panelRef.compareAndSet(panel, null)
  }

  fun toolWindowPanel(): HarborToolWindowPanel? = panelRef.get()

  fun getOrCreateSidecar(): HarborSidecarProcess {
    sidecarRef.get()?.let { return it }
    synchronized(this) {
      sidecarRef.get()?.let { return it }
      val created = HarborSidecarProcess(project)
      Disposer.register(project) {
        sidecarRef.compareAndSet(created, null)
        Disposer.dispose(created)
      }
      created.start()
      sidecarRef.set(created)
      log.info("Harbor shared sidecar started for ${project.name}")
      return created
    }
  }

  fun restartSidecar(): HarborSidecarProcess {
    synchronized(this) {
      sidecarRef.getAndSet(null)?.let { Disposer.dispose(it) }
      return getOrCreateSidecar()
    }
  }

  companion object {
    fun getInstance(project: Project): HarborProjectService =
      project.getService(HarborProjectService::class.java)
  }
}
