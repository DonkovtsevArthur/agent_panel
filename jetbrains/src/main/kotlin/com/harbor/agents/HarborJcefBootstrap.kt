package com.harbor.agents

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import javax.swing.JPanel

fun interface HarborStatusSink {
  fun setStatus(text: String)
}

/**
 * Reflection entry so [HarborToolWindowPanel] never hard-links [HarborJcefSession] / JBCef*.
 */
object HarborJcefBootstrap {
  private val log = Logger.getInstance(HarborJcefBootstrap::class.java)

  fun create(
    project: Project,
    parent: JPanel,
    parentDisposable: Disposable,
    onStatus: HarborStatusSink,
  ): HarborWebSession? {
    if (!HarborJcef.isSupported()) return null
    return try {
      val cls = Class.forName("com.harbor.agents.HarborJcefSession")
      val method = cls.getMethod(
        "tryCreate",
        Project::class.java,
        JPanel::class.java,
        Disposable::class.java,
        HarborStatusSink::class.java,
      )
      method.invoke(null, project, parent, parentDisposable, onStatus) as? HarborWebSession
    } catch (t: Throwable) {
      log.warn("HarborJcefBootstrap.create failed", t)
      null
    }
  }
}
