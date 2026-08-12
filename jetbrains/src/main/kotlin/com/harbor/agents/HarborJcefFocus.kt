package com.harbor.agents

import com.intellij.ui.jcef.JBCefBrowser
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent

/**
 * On macOS, platform JBCef only auto-focuses the browser on mouse press for Windows.
 * Without focus, keyboard can still move :focus rings (Tab) while clicks look "dead".
 * Also focus on mouse enter so the first click is not eaten by focus steal.
 */
object HarborJcefFocus {
  fun install(browser: JBCefBrowser) {
    val focusNow = {
      try {
        browser.cefBrowser.setFocus(true)
      } catch (_: Throwable) {
      }
    }
    val listener = object : MouseAdapter() {
      override fun mousePressed(e: MouseEvent) {
        focusNow()
        (e.component as? JComponent)?.requestFocusInWindow()
      }

      override fun mouseEntered(e: MouseEvent) {
        // Prefocus before the user clicks a chat row — otherwise the first
        // press only focuses JBCef and the DOM never sees a click.
        focusNow()
      }
    }
    try {
      browser.component.isFocusable = true
      browser.component.addMouseListener(listener)
    } catch (_: Throwable) {
    }
    try {
      val ui = browser.cefBrowser.uiComponent
      ui.isFocusable = true
      ui.addMouseListener(listener)
    } catch (_: Throwable) {
    }
    try {
      // Prefer focusing when the component is shown / navigated.
      browser.setProperty("JBCefBrowser.focusOnShow", true)
      browser.setProperty("JBCefBrowser.focusOnNavigation", true)
    } catch (_: Throwable) {
    }
    focusNow()
  }
}
