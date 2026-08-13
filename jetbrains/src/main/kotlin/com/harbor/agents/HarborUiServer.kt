package com.harbor.agents

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.io.FileUtil
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.io.IOException
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.Executors

/**
 * Serves the **same** Harbor webview assets as VS Code (`media/panel.*` + fonts)
 * over `http://127.0.0.1:<port>/`.
 *
 * Remote JCEF cannot use `file://` (JSQuery dies) and struggles with multi-MB
 * `loadHTML` payloads. A tiny localhost server is the thin Kotlin wrapper around
 * the real VS Code UI files.
 */
class HarborUiServer(
  private val rootDir: File,
) : AutoCloseable {
  private val log = Logger.getInstance(HarborUiServer::class.java)
  private var server: HttpServer? = null
  var baseUrl: String = ""
    private set

  fun start(): String {
    val http = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    http.createContext("/") { exchange -> handle(exchange) }
    http.executor = Executors.newCachedThreadPool { r ->
      Thread(r, "harbor-ui-http").apply { isDaemon = true }
    }
    http.start()
    server = http
    val port = http.address.port
    baseUrl = "http://127.0.0.1:$port/"
    log.info("Harbor UI server $baseUrl root=${rootDir.absolutePath}")
    return baseUrl
  }

  private fun handle(exchange: HttpExchange) {
    try {
      var path = exchange.requestURI.path ?: "/"
      if (path == "/" || path.isBlank()) path = "/index.html"
      // prevent path traversal
      val rel = path.removePrefix("/").replace('\\', '/')
      if (rel.contains("..")) {
        exchange.sendResponseHeaders(403, -1)
        exchange.close()
        return
      }
      val file = File(rootDir, rel)
      if (!file.isFile || !file.canonicalPath.startsWith(rootDir.canonicalPath)) {
        val msg = "Not found: $path".toByteArray(StandardCharsets.UTF_8)
        exchange.responseHeaders.add("Content-Type", "text/plain; charset=utf-8")
        exchange.sendResponseHeaders(404, msg.size.toLong())
        exchange.responseBody.use { it.write(msg) }
        return
      }
      val bytes = file.readBytes()
      exchange.responseHeaders.add("Content-Type", contentType(rel))
      exchange.responseHeaders.add("Cache-Control", "no-cache")
      exchange.responseHeaders.add("Access-Control-Allow-Origin", "*")
      exchange.sendResponseHeaders(200, bytes.size.toLong())
      exchange.responseBody.use { it.write(bytes) }
    } catch (t: Throwable) {
      log.warn("Harbor UI HTTP error", t)
      try {
        exchange.sendResponseHeaders(500, -1)
      } catch (_: IOException) {
      }
      exchange.close()
    }
  }

  private fun contentType(path: String): String {
    return when {
      path.endsWith(".html") -> "text/html; charset=utf-8"
      path.endsWith(".js") -> "text/javascript; charset=utf-8"
      path.endsWith(".css") -> "text/css; charset=utf-8"
      path.endsWith(".ttf") -> "font/ttf"
      path.endsWith(".woff2") -> "font/woff2"
      path.endsWith(".svg") -> "image/svg+xml"
      path.endsWith(".png") -> "image/png"
      else -> "application/octet-stream"
    }
  }

  override fun close() {
    try {
      server?.stop(0)
    } catch (_: Throwable) {
    }
    server = null
  }

  companion object {
    fun materializeRoot(): File {
      val version = HarborPluginInfo.version().replace(Regex("[^A-Za-z0-9._-]"), "_")
      val base = File(FileUtil.getTempDirectory(), "harbor-agents-ui-$version")
      if (!base.exists()) base.mkdirs()
      return base
    }
  }
}
