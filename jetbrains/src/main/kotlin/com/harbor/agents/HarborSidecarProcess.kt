package com.harbor.agents

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.io.FileUtil
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Manages the Node harborSidecar.js process (stdio JSON-RPC).
 */
class HarborSidecarProcess(private val project: Project) : Disposable {
  private val log = Logger.getInstance(HarborSidecarProcess::class.java)
  private val started = AtomicBoolean(false)
  private var process: Process? = null
  private var writer: BufferedWriter? = null
  private val executor = Executors.newSingleThreadExecutor { r ->
    Thread(r, "harbor-sidecar-reader").apply { isDaemon = true }
  }
  private val pending = ConcurrentHashMap<String, (JsonElement?) -> Unit>()

  private val notificationListeners =
    java.util.concurrent.CopyOnWriteArrayList<(method: String, params: JsonObject?) -> Unit>()

  fun addNotificationListener(listener: (method: String, params: JsonObject?) -> Unit): () -> Unit {
    notificationListeners.add(listener)
    return { notificationListeners.remove(listener) }
  }
  fun start() {
    if (!started.compareAndSet(false, true)) return
    val script = resolveSidecarScript()
    if (script == null) {
      notify(
        "Harbor sidecar not found. Run `npm run build:sidecar` in the Harbor repo " +
          "or install the plugin with bundled out/harborSidecar.js."
      )
      return
    }
    var node = resolveNodeBinary()
    // If no working node found, try auto-downloading a portable one
    if (!isNodeWorking(node)) {
      node = NodeProvisioner.ensureNode(project) ?: run {
        notify(
          "Harbor: Node.js not found. Install it from <a href='https://nodejs.org'>nodejs.org</a> " +
            "(LTS recommended) and restart the IDE. You can also set the HARBOR_NODE env variable " +
            "to the full path of your node binary."
        )
        started.set(false); return
      }
    }
    val workspace = project.basePath ?: System.getProperty("user.home")
    log.info(
      "Harbor sidecar start script=${script.absolutePath} " +
        "plugin=${HarborPluginInfo.version()} workspace=$workspace",
    )
    try {
      val pb = ProcessBuilder(node, script.absolutePath)
        .directory(script.parentFile)
        .redirectErrorStream(false)
      val env = pb.environment()
      val isWindows = System.getProperty("os.name", "").lowercase().contains("win")
      if (isWindows) {
        // On Windows the PATH separator is ';'; keep it intact.
        val programFiles = System.getenv("ProgramFiles") ?: """C:\Program Files"""
        val extraWin = """$programFiles\nodejs"""
        val existing = env["PATH"] ?: ""
        env["PATH"] = "$extraWin;$existing"
      } else {
        val extras = "/opt/homebrew/bin:/usr/local/bin:/usr/bin"
        env["PATH"] = "$extras:${env["PATH"] ?: ""}"
      }
      env["HARBOR_WORKSPACE"] = workspace
      env["HARBOR_IDE"] = "jetbrains"
      env["HARBOR_OUT_DIR"] = script.parentFile.absolutePath
      env["HARBOR_PLUGIN_VERSION"] = HarborPluginInfo.version()
      val ideaHarbor = File(workspace, ".idea/harbor")
      // Chats stay per-project; settings are global (like VS Code globalState).
      val sessionFile = File(ideaHarbor, "session.v2.json")
      env["HARBOR_SESSION_PATH"] = sessionFile.absolutePath
      val homeDir = System.getProperty("user.home") ?: ""
      val settingsFile = if (homeDir.isNotEmpty()) {
        val globalDir = File(homeDir, ".harbor")
        val globalFile = File(globalDir, "settings.json")
        // Migrate project settings to global on first run.
        val projectFile = File(ideaHarbor, "settings.json")
        if (!globalFile.exists() && projectFile.exists()) {
          globalDir.mkdirs()
          projectFile.copyTo(globalFile, overwrite = true)
          log.info("Harbor: migrated project settings to ${globalFile.absolutePath}")
        }
        globalFile
      } else {
        File(ideaHarbor, "settings.json")  // fallback
      }
      env["HARBOR_SETTINGS_PATH"] = settingsFile.absolutePath
      env["HARBOR_LANG"] = HarborUiLanguage.resolve(project)
      // Match Harbor Advanced → Validate TLS (default off). Must be set before
      // Node boots so undici/OpenSSL honor corporate self-signed gateways.
      if (!readRejectUnauthorized(settingsFile)) {
        env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
      }
      val p = pb.start()
      process = p
      writer = BufferedWriter(OutputStreamWriter(p.outputStream, StandardCharsets.UTF_8))
      executor.submit { readLoop(p) }
      // stderr ready line
      Thread({
        BufferedReader(InputStreamReader(p.errorStream, StandardCharsets.UTF_8)).use { br ->
          br.lineSequence().forEach { line ->
            log.info("[harbor-sidecar] $line")
          }
        }
      }, "harbor-sidecar-stderr").apply { isDaemon = true }.start()

      request("ping", JsonObject()) { result ->
        log.info("Harbor sidecar ping: $result")
      }
    } catch (t: Throwable) {
      log.warn("Failed to start Harbor sidecar", t)
      val msg = t.message ?: ""
      val isNodeMissing = msg.contains("node", ignoreCase = true) &&
        (msg.contains("Cannot run program", ignoreCase = true) ||
         msg.contains("CreateProcess", ignoreCase = true) ||
         msg.contains("No such file", ignoreCase = true) ||
         msg.contains("not found", ignoreCase = true))
      if (isNodeMissing) {
        notify(
          "Harbor: Node.js not found. Install it from <a href='https://nodejs.org'>nodejs.org</a> " +
            "(LTS recommended) and restart the IDE. You can also set the HARBOR_NODE env variable " +
            "to the full path of your node binary."
        )
      } else {
        notify("Failed to start Harbor sidecar: $msg")
      }
      started.set(false)
    }
  }

  fun request(method: String, params: JsonElement?, callback: (JsonElement?) -> Unit) {
    val id = UUID.randomUUID().toString()
    pending[id] = callback
    val req = JsonObject()
    req.addProperty("jsonrpc", "2.0")
    req.addProperty("id", id)
    req.addProperty("method", method)
    if (params != null) {
      req.add("params", params)
    }
    if (!writeLine(req.toString())) {
      pending.remove(id)
      callback(null)
    }
  }

  /** @return false if sidecar stdin is not available */
  private fun writeLine(line: String): Boolean {
    val w = writer ?: return false
    return try {
      synchronized(w) {
        w.write(line)
        w.newLine()
        w.flush()
      }
      true
    } catch (t: Throwable) {
      log.warn("Harbor sidecar write failed", t)
      false
    }
  }

  private fun readLoop(p: Process) {
    BufferedReader(InputStreamReader(p.inputStream, StandardCharsets.UTF_8)).use { br ->
      while (!Thread.currentThread().isInterrupted) {
        val line = br.readLine() ?: break
        if (line.isBlank()) continue
        try {
          handleLine(line)
        } catch (t: Throwable) {
          log.warn("Bad sidecar line: $line", t)
        }
      }
    }
  }

  private fun handleLine(line: String) {
    val el = JsonParser.parseString(line)
    if (!el.isJsonObject) return
    val obj = el.asJsonObject
    if (obj.has("id") && (obj.has("result") || obj.has("error"))) {
      val id = obj.get("id").asString
      val cb = pending.remove(id) ?: return
      if (obj.has("error")) {
        log.warn("Sidecar error: ${obj.get("error")}")
        cb(null)
      } else {
        cb(obj.get("result"))
      }
      return
    }
    if (obj.has("method")) {
      val method = obj.get("method").asString
      val params = obj.get("params")?.takeIf { it.isJsonObject }?.asJsonObject
      for (listener in notificationListeners) {
        try {
          listener(method, params)
        } catch (t: Throwable) {
          log.warn("Harbor notification listener failed", t)
        }
      }
    }
  }

  private fun resolveNodeBinary(): String {
    val fromEnv = System.getenv("HARBOR_NODE")
    if (!fromEnv.isNullOrBlank()) return fromEnv

    val isWindows = System.getProperty("os.name", "").lowercase().contains("win")
    val candidates = mutableListOf("node")

    if (isWindows) {
      // Common Windows install locations
      val programFiles = System.getenv("ProgramFiles") ?: """C:\Program Files"""
      val programFilesX86 = System.getenv("ProgramFiles(x86)") ?: """C:\Program Files (x86)"""
      val localAppData = System.getenv("LOCALAPPDATA") ?: ""
      candidates += """$programFiles\nodejs\node.exe"""
      candidates += """$programFilesX86\nodejs\node.exe"""
      if (localAppData.isNotBlank()) {
        // nvm-windows, fnm, volta defaults
        candidates += """$localAppData\nvm\node.exe"""
        candidates += """$localAppData\fnm\node.exe"""
        candidates += """$localAppData\volta\bin\node.exe"""
      }
      // PATH-based lookup via `where`
      try {
        val p = ProcessBuilder("where", "node").start()
        if (p.waitFor(3, TimeUnit.SECONDS) && p.exitValue() == 0) {
          val found = p.inputStream.bufferedReader().readLine()?.trim()
          if (!found.isNullOrBlank()) candidates.add(0, found)
        }
      } catch (_: Exception) {
      }
    } else {
      candidates += "/usr/local/bin/node"
      candidates += "/opt/homebrew/bin/node"
    }

    for (c in candidates) {
      try {
        val p = ProcessBuilder(c, "-v").start()
        if (p.waitFor(3, TimeUnit.SECONDS) && p.exitValue() == 0) {
          return c
        }
      } catch (_: Exception) {
      }
    }
    return "node"
  }

  private fun isNodeWorking(node: String): Boolean {
    return try {
      val p = ProcessBuilder(node, "-v").start()
      p.waitFor(3, TimeUnit.SECONDS) && p.exitValue() == 0
    } catch (_: Exception) {
      false
    }
  }

  /**
   * Harbor default is Validate TLS = on (strict cert verification). Only
   * disabled when the user explicitly set rejectUnauthorized:false in
   * ~/.harbor/settings.json (corporate MITM proxy without a CA bundle).
   */
  private fun readRejectUnauthorized(settingsFile: File): Boolean {
    if (!settingsFile.isFile) return true
    return try {
      val root = JsonParser.parseString(settingsFile.readText()).asJsonObject
      fun flag(obj: JsonObject?, key: String): Boolean? =
        obj?.get(key)?.takeIf { it.isJsonPrimitive }?.asBoolean
      flag(root, "rejectUnauthorized")
        ?: flag(root.getAsJsonObject("agentPanel"), "rejectUnauthorized")
        ?: true
    } catch (_: Exception) {
      true
    }
  }

  private fun resolveSidecarScript(): File? {
    val fromEnv = System.getenv("HARBOR_SIDECAR")
    if (!fromEnv.isNullOrBlank()) {
      val f = File(fromEnv)
      if (f.exists()) return f
    }
    if (HarborPluginInfo.devOverlay()) {
      val candidates = listOf(
        File(System.getProperty("user.dir"), "../out/harborSidecar.js"),
        File(System.getProperty("user.dir"), "out/harborSidecar.js"),
        File(System.getProperty("user.dir"), "../../out/harborSidecar.js"),
      )
      for (c in candidates) {
        if (c.exists()) return c.canonicalFile
      }
    }

    // Packaged: extract sidecar + clineBundle into a versioned temp dir so an
    // older unzip cannot mix with a newly installed plugin.
    val stream = javaClass.getResourceAsStream("/harbor/sidecar/harborSidecar.js")
      ?: javaClass.getResourceAsStream("/sidecar/harborSidecar.js")
    if (stream != null) {
      val version = HarborPluginInfo.version().replace(Regex("[^A-Za-z0-9._-]"), "_")
      val dir = File(FileUtil.getTempDirectory(), "harbor-sidecar-$version")
      dir.mkdirs()
      val out = File(dir, "harborSidecar.js")
      stream.use { input -> out.outputStream().use { input.copyTo(it) } }
      val clineStream = javaClass.getResourceAsStream("/harbor/sidecar/clineBundle.js")
        ?: javaClass.getResourceAsStream("/sidecar/clineBundle.js")
      if (clineStream != null) {
        val clineOut = File(dir, "clineBundle.js")
        clineStream.use { input -> clineOut.outputStream().use { input.copyTo(it) } }
      }
      return out
    }

    val fallback = listOf(
      File(System.getProperty("user.dir"), "../out/harborSidecar.js"),
      File(System.getProperty("user.dir"), "out/harborSidecar.js"),
      File(System.getProperty("user.dir"), "../../out/harborSidecar.js"),
    )
    for (c in fallback) {
      if (c.exists()) return c.canonicalFile
    }
    return null
  }

  private fun notify(message: String) {
    NotificationGroupManager.getInstance()
      .getNotificationGroup("Harbor Agents")
      .createNotification(message, NotificationType.WARNING)
      .notify(project)
  }

  override fun dispose() {
    started.set(false)
    try {
      writer?.close()
    } catch (_: Exception) {
    }
    process?.destroy()
    executor.shutdownNow()
  }
}
