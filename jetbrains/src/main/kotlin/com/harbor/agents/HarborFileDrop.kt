package com.harbor.agents

import com.google.gson.Gson
import com.intellij.openapi.diagnostic.Logger
import java.awt.datatransfer.DataFlavor
import java.awt.dnd.DnDConstants
import java.awt.dnd.DropTarget
import java.awt.dnd.DropTargetAdapter
import java.awt.dnd.DropTargetDragEvent
import java.awt.dnd.DropTargetDropEvent
import java.io.File
import javax.swing.JComponent
import javax.swing.SwingUtilities

/**
 * JCEF OSR does not deliver OS→page HTML5 file drops. Catch files on the
 * Swing component and forward them to the webview as `attachmentsAdded`.
 */
object HarborFileDrop {
  private val log = Logger.getInstance(HarborFileDrop::class.java)
  private val gson = Gson()
  private val imageExt = setOf("png", "jpg", "jpeg", "gif", "webp", "bmp")

  fun install(
    component: JComponent,
    onAttachments: (List<Map<String, Any>>) -> Unit,
    onDragActive: ((Boolean) -> Unit)? = null,
  ): DropTarget {
    val listener =
      object : DropTargetAdapter() {
        override fun dragEnter(dtde: DropTargetDragEvent) {
          if (hasFiles(dtde.transferable)) {
            dtde.acceptDrag(DnDConstants.ACTION_COPY)
            onDragActive?.invoke(true)
          } else {
            dtde.rejectDrag()
          }
        }

        override fun dragOver(dtde: DropTargetDragEvent) {
          if (hasFiles(dtde.transferable)) {
            dtde.acceptDrag(DnDConstants.ACTION_COPY)
          } else {
            dtde.rejectDrag()
          }
        }

        override fun dragExit(dte: java.awt.dnd.DropTargetEvent) {
          onDragActive?.invoke(false)
        }

        override fun drop(dtde: DropTargetDropEvent) {
          onDragActive?.invoke(false)
          try {
            dtde.acceptDrop(DnDConstants.ACTION_COPY)
            val files = extractFiles(dtde.transferable)
            if (files.isEmpty()) {
              dtde.dropComplete(false)
              return
            }
            val attachments = mutableListOf<Map<String, Any>>()
            for (file in files) {
              if (!file.isFile) continue
              val ext = file.extension.lowercase()
              if (ext !in imageExt && !looksLikeImageName(file.name)) {
                // Still try encode if mime would be image; otherwise skip non-images
                // for now (composer “+” is images-first; drop of images is the ask).
                if (ext !in imageExt) continue
              }
              HarborClipboard.encodeFile(file)?.let { attachments.add(it) }
              if (attachments.size >= 8) break
            }
            dtde.dropComplete(attachments.isNotEmpty())
            if (attachments.isNotEmpty()) {
              SwingUtilities.invokeLater { onAttachments(attachments) }
            }
          } catch (t: Throwable) {
            log.warn("Harbor file drop failed", t)
            try {
              dtde.dropComplete(false)
            } catch (_: Throwable) {
            }
          }
        }
      }
    return DropTarget(component, DnDConstants.ACTION_COPY, listener, true)
  }

  private fun looksLikeImageName(name: String): Boolean {
    val lower = name.lowercase()
    return imageExt.any { lower.endsWith(".$it") }
  }

  private fun hasFiles(transferable: java.awt.datatransfer.Transferable): Boolean {
    return try {
      transferable.isDataFlavorSupported(DataFlavor.javaFileListFlavor) ||
        transferable.isDataFlavorSupported(DataFlavor.stringFlavor)
    } catch (_: Throwable) {
      false
    }
  }

  @Suppress("UNCHECKED_CAST")
  private fun extractFiles(
    transferable: java.awt.datatransfer.Transferable
  ): List<File> {
    val out = mutableListOf<File>()
    try {
      if (transferable.isDataFlavorSupported(DataFlavor.javaFileListFlavor)) {
        val list =
          transferable.getTransferData(DataFlavor.javaFileListFlavor) as? List<*>
        list?.forEach { item ->
          when (item) {
            is File -> out.add(item)
            is String -> {
              val f = File(item)
              if (f.exists()) out.add(f)
            }
          }
        }
      }
    } catch (t: Throwable) {
      log.warn("Harbor drop file-list flavor failed", t)
    }
    if (out.isEmpty()) {
      try {
        if (transferable.isDataFlavorSupported(DataFlavor.stringFlavor)) {
          val text = transferable.getTransferData(DataFlavor.stringFlavor) as? String
          for (line in (text ?: "").lineSequence()) {
            val raw = line.trim().removePrefix("file://")
            if (raw.isBlank()) continue
            val f = File(java.net.URI(if (raw.startsWith("/")) "file://$raw" else raw).path)
            if (f.isFile) out.add(f)
          }
        }
      } catch (_: Throwable) {
        // ignore URI parse errors
      }
    }
    return out.distinctBy { it.absolutePath }
  }

  fun attachmentsJson(attachments: List<Map<String, Any>>): String =
    gson.toJson(
      mapOf(
        "type" to "attachmentsAdded",
        "attachments" to attachments,
      )
    )
}
