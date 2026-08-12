package com.harbor.agents

/**
 * JCEF may be missing, disabled, or not linked into the plugin classloader.
 * Probe only via reflection — never import JBCef* from this file.
 */
object HarborJcef {
  fun isSupported(): Boolean {
    return try {
      val cls = Class.forName("com.intellij.ui.jcef.JBCefApp")
      val supported = cls.getMethod("isSupported").invoke(null) as Boolean
      if (!supported) return false
      Class.forName("com.intellij.ui.jcef.JBCefBrowser")
      true
    } catch (_: Throwable) {
      false
    }
  }
}
