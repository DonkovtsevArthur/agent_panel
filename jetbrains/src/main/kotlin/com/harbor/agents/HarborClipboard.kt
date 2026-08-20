package com.harbor.agents

import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.ide.CopyPasteManager
import java.awt.Graphics2D
import java.awt.Image
import java.awt.datatransfer.DataFlavor
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Base64
import java.util.UUID
import javax.imageio.ImageIO

/**
 * Read images from the system clipboard / file list for JCEF (webview paste
 * usually cannot see macOS image clipboard).
 */
object HarborClipboard {
  private val log = Logger.getInstance(HarborClipboard::class.java)
  private val imageExt = setOf("png", "jpg", "jpeg", "gif", "webp", "bmp")

  fun readImageAttachments(): List<Map<String, Any>> {
    val out = mutableListOf<Map<String, Any>>()
    try {
      val contents = CopyPasteManager.getInstance().contents ?: return emptyList()

      if (contents.isDataFlavorSupported(DataFlavor.imageFlavor)) {
        val image = contents.getTransferData(DataFlavor.imageFlavor) as? Image
        if (image != null) {
          encodeImage(image, "clipboard.png")?.let { out.add(it) }
        }
      }

      if (out.isEmpty() && contents.isDataFlavorSupported(DataFlavor.javaFileListFlavor)) {
        @Suppress("UNCHECKED_CAST")
        val files =
          contents.getTransferData(DataFlavor.javaFileListFlavor) as? List<File>
            ?: emptyList()
        for (file in files) {
          if (!file.isFile) continue
          val ext = file.extension.lowercase()
          if (ext !in imageExt) continue
          encodeFile(file)?.let { out.add(it) }
          if (out.size >= 8) break
        }
      }
    } catch (t: Throwable) {
      log.warn("Harbor clipboard image read failed", t)
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
