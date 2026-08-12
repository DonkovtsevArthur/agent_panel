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
    val node = resolveNodeBinary()
    val workspace = project.basePath ?: System.getProperty("user.home")
    try {
      val pb = ProcessBuilder(node, script.absolutePath)
        .directory(script.parentFile)
        .redirectErrorStream(false)
      pb.environment()["HARBOR_WORKSPACE"] = workspace
      pb.environment()["HARBOR_IDE"] = "jetbrains"
      pb.environment()["HARBOR_OUT_DIR"] = script.parentFile.absolutePath
      val ideaHarbor = File(workspace, ".idea/harbor")
      val settingsFile = File(ideaHarbor, "settings.json")
      pb.environment()["HARBOR_SESSION_PATH"] = File(ideaHarbor, "session.v2.json").absolutePath
      pb.environment()["HARBOR_SETTINGS_PATH"] = settingsFile.absolutePath
      // Match Harbor Advanced → Validate TLS (default off). Must be set before
      // Node boots so undici/OpenSSL honor corporate self-signed gateways.
      if (!readRejectUnauthorized(settingsFile)) {
        pb.environment()["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
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
      notify("Failed to start Harbor sidecar: ${t.message}")
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
    writeLine(req.toString())
  }

  private fun writeLine(line: String) {
    val w = writer ?: return
    synchronized(w) {
      w.write(line)
      w.newLine()
      w.flush()
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
    val candidates = listOf("node", "/usr/local/bin/node", "/opt/homebrew/bin/node")
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

  /**
   * Harbor default is Validate TLS = off. Only enforce certs when the user
   * explicitly set rejectUnauthorized:true in .idea/harbor/settings.json.
   */
  private fun readRejectUnauthorized(settingsFile: File): Boolean {
    if (!settingsFile.isFile) return false
    return try {
      val root = JsonParser.parseString(settingsFile.readText()).asJsonObject
      fun flag(obj: JsonObject?, key: String): Boolean? =
        obj?.get(key)?.takeIf { it.isJsonPrimitive }?.asBoolean
      flag(root, "rejectUnauthorized")
        ?: flag(root.getAsJsonObject("agentPanel"), "rejectUnauthorized")
        ?: false
    } catch (_: Exception) {
      false
    }
  }

  private fun resolveSidecarScript(): File? {
    val fromEnv = System.getenv("HARBOR_SIDECAR")
    if (!fromEnv.isNullOrBlank()) {
      val f = File(fromEnv)
      if (f.exists()) return f
    }
    // Dev: ../out/harborSidecar.js relative to jetbrains/ or repo root
    val candidates = listOf(
      File(System.getProperty("user.dir"), "../out/harborSidecar.js"),
      File(System.getProperty("user.dir"), "out/harborSidecar.js"),
      File(System.getProperty("user.dir"), "../../out/harborSidecar.js"),
    )
    for (c in candidates) {
      if (c.exists()) return c.canonicalFile
    }

    // Packaged: extract sidecar + clineBundle into the same temp dir
    val stream = javaClass.getResourceAsStream("/harbor/sidecar/harborSidecar.js")
      ?: javaClass.getResourceAsStream("/sidecar/harborSidecar.js")
    if (stream != null) {
      val dir = File(FileUtil.getTempDirectory(), "harbor-sidecar")
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
