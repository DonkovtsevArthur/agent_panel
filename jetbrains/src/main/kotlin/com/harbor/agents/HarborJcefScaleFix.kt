package com.harbor.agents

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefBrowser
import java.awt.Component
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import java.beans.PropertyChangeListener
import javax.swing.SwingUtilities
import javax.swing.Timer
import kotlin.math.abs

/**
 * JCEF OSR paints into a buffer sized by the display scale factor that was
 * current when the frame was rendered. Moving the IDE (most often a fullscreen
 * space dragged over) from a screen with one DPI to a screen with another
 * leaves that buffer in place: the panel is upscaled and its text becomes
 * pixelated.
 *
 * Platform JBCef resyncs the scale only on a `graphicsConfiguration` property
 * change, and even then only calls `notifyScreenInfoChanged()`
 * (`JBCefOsrComponent.lambda$new$0`) — no `wasResized`, and a fullscreen move
 * between displays fires no Swing event at all. So watch the effective scale
 * ourselves (component events + a cheap poll) and tell CEF to re-query screen
 * info and repaint whenever it changes. `CefBrowser.getScreenInfo` computes
 * the factor live (`JCefAppConfig.getDeviceScaleFactor(component)`), so the
 * re-query picks up the display the component is on right now.
 */
object HarborJcefScaleFix {
  private val log = Logger.getInstance(HarborJcefScaleFix::class.java)

  /** Poll is two field reads and covers fullscreen moves that fire no event. */
  private const val POLL_MS = 800

  /** Second pass: OSR paints lag behind the resize notification. */
  private const val RECHECK_MS = 260

  fun install(browser: JBCefBrowser, parentDisposable: Disposable) {
    var lastScale = scaleOf(browser)
    val check = Runnable {
      val scale = scaleOf(browser)
      if (scale > 0 && lastScale > 0 && abs(scale - lastScale) > 0.001) {
        log.info("Harbor JCEF scale changed $lastScale -> $scale")
        lastScale = scale
        resync(browser)
        Timer(RECHECK_MS) { resync(browser) }.also {
          it.isRepeats = false
          it.start()
        }
      }
    }
    val component = targetComponent(browser) ?: return
    try {
      component.addPropertyChangeListener(
        "graphicsConfiguration",
        PropertyChangeListener { check.run() },
      )
      component.addComponentListener(object : ComponentAdapter() {
        override fun componentMoved(e: ComponentEvent) {
          check.run()
        }

        override fun componentResized(e: ComponentEvent) {
          check.run()
        }
      })
    } catch (t: Throwable) {
      log.warn("Harbor JCEF scale listeners not installed", t)
    }
    val timer = Timer(POLL_MS) { check.run() }
    timer.isRepeats = true
    timer.start()
    Disposer.register(parentDisposable, Disposable { timer.stop() })
  }

  /** The OSR surface: it is what the render handler reads the scale from. */
  private fun targetComponent(browser: JBCefBrowser): Component? {
    return try {
      browser.cefBrowser.uiComponent ?: browser.component
    } catch (_: Throwable) {
      try {
        browser.component
      } catch (_: Throwable) {
        null
      }
    }
  }

  private fun scaleOf(browser: JBCefBrowser): Double {
    return try {
      val configuration = targetComponent(browser)?.graphicsConfiguration ?: return 0.0
      configuration.defaultTransform.scaleX
    } catch (_: Throwable) {
      0.0
    }
  }

  private fun resync(browser: JBCefBrowser) {
    SwingUtilities.invokeLater {
      try {
        val ui = targetComponent(browser) ?: return@invokeLater
        val width = ui.width.coerceAtLeast(0)
        val height = ui.height.coerceAtLeast(0)
        // Re-query getScreenInfo (fresh device scale factor) and force a full
        // repaint at it — the platform path does the first half only.
        browser.cefBrowser.notifyScreenInfoChanged()
        browser.cefBrowser.wasResized(width, height)
        ui.repaint()
        browser.component.repaint()
      } catch (t: Throwable) {
        log.warn("Harbor JCEF scale resync failed", t)
      }
    }
  }
}
