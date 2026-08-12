package com.harbor.agents

import com.intellij.openapi.diagnostic.Logger
import com.intellij.ui.jcef.JBCefBrowser

/**
 * Previously synthesized DOM clicks for remote JCEF. That path created dozens of
 * empty "New Agent" chats (offset hits on +) and fought native events.
 *
 * Disabled: rely on OSR native mouse + [HarborJcefFocus] only.
 */
object HarborJcefClickBridge {
  private val log = Logger.getInstance(HarborJcefClickBridge::class.java)

  fun install(browser: JBCefBrowser) {
    log.info("Harbor click bridge disabled (use native OSR + focus)")
  }
}
