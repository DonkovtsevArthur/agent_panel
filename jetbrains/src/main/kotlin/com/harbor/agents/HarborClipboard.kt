package com.harbor.agents

import com.google.gson.JsonObject
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.util.SystemInfo
import java.awt.Graphics2D
import java.awt.Image
import java.awt.Toolkit
import java.awt.datatransfer.DataFlavor
import java.awt.datatransfer.Transferable
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URLConnection
import java.util.Base64
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.imageio.ImageIO

/**
 * Read copied files (any type) and images from the system clipboard for JCEF
 * (webview paste usually cannot see the macOS clipboard).
 */
object HarborClipboard {
  private val log = Logger.getInstance(HarborClipboard::class.java)
  private val imageExt = setOf("png", "jpg", "jpeg", "gif", "webp", "bmp")

  /** Plain-text clipboard contents for the webview edit context menu (Paste). */
  fun readText(): String {
    return try {
      val contents = CopyPasteManager.getInstance().contents ?: return ""
      if (contents.isDataFlavorSupported(DataFlavor.stringFlavor)) {
        contents.getTransferData(DataFlavor.stringFlavor) as? String ?: ""
      } else {
        ""
      }
    } catch (t: Throwable) {
      log.warn("Harbor clipboard text read failed", t)
      ""
    }
  }

  fun readClipboardAttachments(): List<Map<String, Any>> {
    // A file copied in Finder also puts its *icon* on the clipboard as an
    // image — read the real files first, image data only after that.
    // macOS: the IDE clipboard bridge often exposes only text for a Finder
    // copy (no javaFileListFlavor), so ask the pasteboard directly.
    val macFiles = readMacPasteboardFiles()
    if (macFiles.isNotEmpty()) return macFiles
    // CopyPasteManager may hand back the IDE's own last copy (text) after a
    // macOS screenshot landed in the system clipboard — fall back to AWT.
    for ((contents, source) in listOf(ideContents() to "ide", systemContents() to "system")) {
      val files = readFlavorAttachments(contents, source, DataFlavor.javaFileListFlavor)
      if (files.isNotEmpty()) return files
    }
    for ((contents, source) in listOf(ideContents() to "ide", systemContents() to "system")) {
      val images = readFlavorAttachments(contents, source, DataFlavor.imageFlavor)
      if (images.isNotEmpty()) return images
    }
    val macImage = readMacPasteboardPng()
    if (macImage.isNotEmpty()) return macImage
    log.info(
      "Harbor clipboard: no file or image (ide flavors=${flavorNames(ideContents())}, " +
        "system flavors=${flavorNames(systemContents())})"
    )
    return emptyList()
  }

  private fun readMacPasteboardFiles(): List<Map<String, Any>> {
    if (!SystemInfo.isMac) return emptyList()
    val out = mutableListOf<Map<String, Any>>()
    try {
      val paths =
        osascript(
          """
          set out to ""
          try
            repeat with f in (the clipboard as list)
              try
                set out to out & POSIX path of (f as «class furl») & linefeed
              end try
            end repeat
          end try
          if out is "" then
            try
              set out to POSIX path of (the clipboard as «class furl»)
            end try
          end if
          return out
          """.trimIndent()
        )
      for (line in paths.lines()) {
        val file = File(line.trim())
        if (!file.isFile) continue
        encodeAnyFile(file)?.let { out.add(it) }
        if (out.size >= 8) break
      }
    } catch (t: Throwable) {
      log.warn("Harbor clipboard (macOS files) read failed", t)
    }
    return out
  }

  /** Raw image data (screenshot to clipboard, "Copy image" in apps). */
  private fun readMacPasteboardPng(): List<Map<String, Any>> {
    if (!SystemInfo.isMac) return emptyList()
    val tmp = File.createTempFile("harbor-clip", ".png")
    try {
      val ok =
        osascript(
          """
          try
            set d to the clipboard as «class PNGf»
          on error
            return "no"
          end try
          set fh to open for access (POSIX file "${tmp.absolutePath}") with write permission
          set eof fh to 0
          write d to fh
          close access fh
          return "ok"
          """.trimIndent()
        )
      if (ok.trim() == "ok" && tmp.length() > 0) {
        val att = encodeFile(tmp) ?: return emptyList()
        return listOf(att + mapOf("name" to "clipboard.png"))
      }
    } catch (t: Throwable) {
      log.warn("Harbor clipboard (macOS image) read failed", t)
    } finally {
      tmp.delete()
    }
    return emptyList()
  }

  private fun osascript(script: String): String {
    val proc = ProcessBuilder("osascript", "-e", script).redirectErrorStream(true).start()
    val text = proc.inputStream.bufferedReader().readText()
    if (!proc.waitFor(5, TimeUnit.SECONDS)) {
      proc.destroyForcibly()
      return ""
    }
    return if (proc.exitValue() == 0) text else ""
  }

  private fun ideContents(): Transferable? =
    try {
      CopyPasteManager.getInstance().contents
    } catch (t: Throwable) {
      log.warn("Harbor clipboard (ide) read failed", t)
      null
    }

  private fun systemContents(): Transferable? =
    try {
      Toolkit.getDefaultToolkit().systemClipboard.getContents(null)
    } catch (t: Throwable) {
      log.warn("Harbor clipboard (system) read failed", t)
      null
    }

  private fun flavorNames(contents: Transferable?): String =
    contents?.transferDataFlavors?.joinToString(",") { it.mimeType.substringBefore(';') }
      ?: "none"

  private fun readFlavorAttachments(
    contents: Transferable?,
    source: String,
    flavor: DataFlavor,
  ): List<Map<String, Any>> {
    val out = mutableListOf<Map<String, Any>>()
    if (contents == null || !contents.isDataFlavorSupported(flavor)) return out
    try {
      if (flavor == DataFlavor.imageFlavor) {
        val image = contents.getTransferData(flavor) as? Image
        if (image != null) {
          encodeImage(image, "clipboard.png")?.let { out.add(it) }
        }
      } else {
        @Suppress("UNCHECKED_CAST")
        val files = contents.getTransferData(flavor) as? List<File> ?: emptyList()
        for (file in files) {
          if (!file.isFile) continue
          encodeAnyFile(file)?.let { out.add(it) }
          if (out.size >= 8) break
        }
      }
    } catch (t: Throwable) {
      log.warn("Harbor clipboard read failed ($source)", t)
    }
    return out
  }

  fun encodeFile(file: File): Map<String, Any>? {
    return try {
      val ext = file.extension.lowercase()
      if (ext !in imageExt) {
        return null
      }
      val bytes = file.readBytes()
      if (bytes.isEmpty() || bytes.size > 12 * 1024 * 1024) {
        return null
      }
      val mime =
        when (ext) {
          "jpg", "jpeg" -> "image/jpeg"
          "gif" -> "image/gif"
          "webp" -> "image/webp"
          "bmp" -> "image/bmp"
          else -> "image/png"
        }
      val b64 = Base64.getEncoder().encodeToString(bytes)
      attachment(file.name, mime, b64, bytes.size)
    } catch (t: Throwable) {
      log.warn("Harbor encode file failed: ${file.path}", t)
      null
    }
  }

  /**
   * Image → inline bytes ([encodeFile]); any other file → path reference.
   * The sidecar keeps `path` attachments as-is and reads them at turn time
   * (text inlined, binary named), so large files never cross JSQuery.
   */
  fun encodeAnyFile(file: File): Map<String, Any>? {
    if (file.extension.lowercase() in imageExt) return encodeFile(file)
    return try {
      val mime =
        URLConnection.guessContentTypeFromName(file.name) ?: "application/octet-stream"
      mapOf(
        "id" to "file_${UUID.randomUUID().toString().take(8)}",
        "kind" to "file",
        "name" to file.name,
        "mime" to mime,
        "size" to file.length(),
        "path" to file.absolutePath,
      )
    } catch (t: Throwable) {
      log.warn("Harbor encode file failed: ${file.path}", t)
      null
    }
  }

  private fun encodeImage(image: Image, name: String): Map<String, Any>? {
    return try {
      val buffered = toBufferedImage(image)
      val baos = ByteArrayOutputStream()
      if (!ImageIO.write(buffered, "png", baos)) {
        return null
      }
      val bytes = baos.toByteArray()
      if (bytes.isEmpty()) return null
      val b64 = Base64.getEncoder().encodeToString(bytes)
      attachment(name, "image/png", b64, bytes.size)
    } catch (t: Throwable) {
      log.warn("Harbor encode clipboard image failed", t)
      null
    }
  }

  /** Row of webview `attachFiles` (`attachmentPayload`) → attachment. */
  fun fromWebviewFile(file: JsonObject): Map<String, Any>? {
    val data = file.get("dataBase64")?.takeIf { it.isJsonPrimitive }?.asString
    if (data.isNullOrBlank()) return null
    val name = file.get("name")?.takeIf { it.isJsonPrimitive }?.asString ?: "file"
    val mime =
      file.get("mime")?.takeIf { it.isJsonPrimitive }?.asString ?: "application/octet-stream"
    val size =
      file.get("size")?.takeIf { it.isJsonPrimitive }?.asInt ?: (data.length / 4 * 3)
    if (!mime.startsWith("image/")) {
      return mapOf(
        "id" to "file_${UUID.randomUUID().toString().take(8)}",
        "kind" to "file",
        "name" to name,
        "mime" to mime,
        "size" to size,
        "dataBase64" to data,
      )
    }
    return attachment(name, mime, data, size)
  }

  private fun attachment(
    name: String,
    mime: String,
    dataBase64: String,
    size: Int,
  ): Map<String, Any> {
    val id = "clip_${UUID.randomUUID().toString().take(8)}"
    return mapOf(
      "id" to id,
      "kind" to "image",
      "name" to name,
      "mime" to mime,
      "size" to size,
      "dataBase64" to dataBase64,
      "previewDataUrl" to "data:$mime;base64,$dataBase64",
    )
  }

  private fun toBufferedImage(image: Image): BufferedImage {
    if (image is BufferedImage) {
      return image
    }
    val w = image.getWidth(null).coerceAtLeast(1)
    val h = image.getHeight(null).coerceAtLeast(1)
    val buffered = BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB)
    val g: Graphics2D = buffered.createGraphics()
    try {
      g.drawImage(image, 0, 0, null)
    } finally {
      g.dispose()
    }
    return buffered
  }
}
