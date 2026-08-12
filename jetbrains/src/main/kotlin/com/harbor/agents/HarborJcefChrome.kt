package com.harbor.agents

import com.intellij.ui.jcef.JBCefBrowser
import org.cef.browser.CefBrowser
import org.cef.handler.CefDisplayHandlerAdapter
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseMotionAdapter
import javax.swing.SwingUtilities
import javax.swing.Timer

/**
 * JCEF OSR (especially out-of-process / remote) does not apply CSS cursors to the
 * Swing host, and HTML `title` tooltips are never drawn. Cursor is driven from the
 * webview via `jcefChrome` messages; tooltips are drawn in-page by panel.js.
 *
 * OSR's own [org.cef.handler.CefRenderHandler.onCursorChange] often resets the AWT
 * cursor to DEFAULT — we re-assert the desired cursor on every mouse move / after
 * a short delay so our value wins.
 */
object HarborJcefChrome {
  @Volatile private var desiredCursor: Cursor = Cursor.getDefaultCursor()
  @Volatile private var lastCssCursor = ""
  private var reassertTimer: Timer? = null

  fun install(browser: JBCefBrowser) {
    val reassert = Runnable { applyDesired(browser) }
    val motion =
      object : MouseMotionAdapter() {
        override fun mouseMoved(e: MouseEvent) {
          applyDesired(browser)
          scheduleReassert(reassert)
        }

        override fun mouseDragged(e: MouseEvent) {
          applyDesired(browser)
        }
      }
    val enter =
      object : MouseAdapter() {
        override fun mouseEntered(e: MouseEvent) {
          applyDesired(browser)
        }

        override fun mouseExited(e: MouseEvent) {
          desiredCursor = Cursor.getDefaultCursor()
          lastCssCursor = ""
          applyDesired(browser)
        }
      }
    for (target in listOf(browser.component, browser.cefBrowser.uiComponent)) {
      try {
        target.addMouseMotionListener(motion)
        target.addMouseListener(enter)
      } catch (_: Throwable) {
      }
    }
    try {
      browser.jbCefClient.addDisplayHandler(
        object : CefDisplayHandlerAdapter() {
          override fun onTooltip(cefBrowser: CefBrowser?, text: String?): Boolean {
            // In-page tips in panel.js — suppress native/empty handling.
            return true
          }

          override fun onCursorChange(cefBrowser: CefBrowser?, cursorType: Int): Boolean {
            // Ignore CEF cursor (often wrong / always default on remote). Keep ours.
            applyDesired(browser)
            scheduleReassert(reassert)
            return true
          }
        },
        browser.cefBrowser,
      )
    } catch (_: Throwable) {
    }
  }

  fun applyFromWebview(
    browser: JBCefBrowser,
    cssCursor: String,
    @Suppress("UNUSED_PARAMETER") title: String,
    @Suppress("UNUSED_PARAMETER") x: Int? = null,
    @Suppress("UNUSED_PARAMETER") y: Int? = null,
  ) {
    val key = cssCursor.trim().lowercase()
    if (key != lastCssCursor) {
      lastCssCursor = key
      desiredCursor = mapCssCursor(key)
    }
    applyDesired(browser)
    scheduleReassert { applyDesired(browser) }
  }

  private fun scheduleReassert(action: Runnable) {
    SwingUtilities.invokeLater {
      reassertTimer?.stop()
      val timer =
        Timer(16) {
          action.run()
        }
      timer.isRepeats = false
      reassertTimer = timer
      timer.start()
    }
  }

  private fun applyDesired(browser: JBCefBrowser) {
    val cursor = desiredCursor
    val apply = {
      try {
        browser.cefBrowser.uiComponent.cursor = cursor
      } catch (_: Throwable) {
      }
      try {
        browser.component.cursor = cursor
      } catch (_: Throwable) {
      }
    }
    if (SwingUtilities.isEventDispatchThread()) {
      apply()
      // Second tick beats JBCefOsrHandler's invokeLater(setCursor).
      SwingUtilities.invokeLater(apply)
    } else {
      SwingUtilities.invokeLater {
        apply()
        SwingUtilities.invokeLater(apply)
      }
    }
  }

  private fun mapCssCursor(css: String): Cursor {
    val name = css.substringBefore(",").trim().lowercase()
    return when {
      name == "pointer" || name == "hand" || name.contains("pointer") ->
        Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
      name == "text" || name == "vertical-text" ->
        Cursor.getPredefinedCursor(Cursor.TEXT_CURSOR)
      name == "wait" || name == "progress" ->
        Cursor.getPredefinedCursor(Cursor.WAIT_CURSOR)
      name == "crosshair" -> Cursor.getPredefinedCursor(Cursor.CROSSHAIR_CURSOR)
      name == "move" || name == "grab" || name == "grabbing" || name == "all-scroll" ->
        Cursor.getPredefinedCursor(Cursor.MOVE_CURSOR)
      name == "col-resize" || name == "ew-resize" ->
        Cursor.getPredefinedCursor(Cursor.E_RESIZE_CURSOR)
      name == "row-resize" || name == "ns-resize" ->
        Cursor.getPredefinedCursor(Cursor.N_RESIZE_CURSOR)
      name == "nesw-resize" -> Cursor.getPredefinedCursor(Cursor.NE_RESIZE_CURSOR)
      name == "nwse-resize" -> Cursor.getPredefinedCursor(Cursor.NW_RESIZE_CURSOR)
      name == "n-resize" -> Cursor.getPredefinedCursor(Cursor.N_RESIZE_CURSOR)
      name == "s-resize" -> Cursor.getPredefinedCursor(Cursor.S_RESIZE_CURSOR)
      name == "e-resize" -> Cursor.getPredefinedCursor(Cursor.E_RESIZE_CURSOR)
      name == "w-resize" -> Cursor.getPredefinedCursor(Cursor.W_RESIZE_CURSOR)
      else -> Cursor.getDefaultCursor()
    }
  }
}
