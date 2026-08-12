package com.harbor.agents

/**
 * Chat/settings UI session API without JBCef types (safe to reference from any class).
 */
interface HarborWebSession {
  /** Settings chrome inside the same tool-window JCEF (no second browser / dialog). */
  fun openSettingsSurface(): Boolean
  /** Alias for openSettingsSurface — kept for older call sites. */
  fun openSettingsModal(): Boolean
  fun closeSettingsModal()
  fun openChatSurface()
  fun postToWebview(json: String, forceRepaint: Boolean = false)
}
