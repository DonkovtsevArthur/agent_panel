package com.harbor.agents

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import java.io.File
import java.net.URI
import java.util.zip.ZipFile

/**
 * Auto-downloads a portable Node.js to ~/.harbor/node/ when the system
 * does not have one installed. Cached for subsequent launches.
 */
object NodeProvisioner {
    private const val NODE_VERSION = "22.16.0"
    private val log = Logger.getInstance(NodeProvisioner::class.java)

    fun ensureNode(project: Project): String? {
        val cached = cachedNodeBinary()
        if (cached != null && cached.canExecute()) return cached.absolutePath
        return downloadNode(project)
    }

    private fun nodeDir(): File {
        val home = System.getProperty("user.home") ?: error("user.home not set")
        return File(home, ".harbor/node")
    }

    private fun cachedNodeBinary(): File? {
        val dir = nodeDir()
        if (!dir.isDirectory) return null
        return if (isWindows()) {
            val f = File(dir, "node.exe")
            if (f.exists()) f else null
        } else {
            dir.listFiles()?.firstOrNull()?.let { File(it, "bin/node") }
                ?.takeIf { it.exists() }
        }
    }

    private fun downloadNode(project: Project): String? {
        val os = platformOs() ?: return null
        val arch = platformArch() ?: return null
        val (archiveName, unpackDir) = when (os) {
            "win" -> "node-v$NODE_VERSION-win-$arch.zip" to "node-v$NODE_VERSION-win-$arch"
            "darwin" -> "node-v$NODE_VERSION-darwin-$arch.tar.gz" to "node-v$NODE_VERSION-darwin-$arch"
            else -> "node-v$NODE_VERSION-linux-$arch.tar.gz" to "node-v$NODE_VERSION-linux-$arch"
        }
        val url = "https://nodejs.org/dist/v$NODE_VERSION/$archiveName"
        val destDir = nodeDir()
        log.info("Harbor: provisioning Node.js v$NODE_VERSION from $url")

        var result: String? = null
        object : Task.Backgroundable(project, "Harbor: downloading Node.js…", false) {
            override fun run(indicator: ProgressIndicator) {
                indicator.isIndeterminate = false
                try {
                    destDir.mkdirs()
                    val archive = File(destDir, archiveName)
                    indicator.text = "Downloading Node.js v$NODE_VERSION…"
                    download(url, archive, indicator)
                    indicator.text = "Extracting…"
                    indicator.fraction = 0.7
                    if (os == "win") extractZip(archive, destDir)
                    else extractTarGz(archive, destDir)
                    archive.delete()
                    val bin = if (isWindows()) File(destDir, "$unpackDir/node.exe")
                              else File(destDir, "$unpackDir/bin/node")
                    if (!bin.exists()) { log.warn("Harbor: node not found at ${bin}"); return }
                    bin.setExecutable(true)
                    result = bin.absolutePath
                    log.info("Harbor: Node.js provisioned at ${bin.absolutePath}")
                } catch (e: Exception) {
                    log.warn("Harbor: Node.js download failed", e)
                    destDir.deleteRecursively()
                }
            }
            override fun onSuccess() {
                if (result == null) {
                    NotificationGroupManager.getInstance()
                        .getNotificationGroup("Harbor Agents")
                        .createNotification(
                            "Harbor: failed to download Node.js. Install manually from " +
                                "<a href='https://nodejs.org'>nodejs.org</a> (LTS) and restart.",
                            NotificationType.WARNING
                        ).notify(project)
                }
            }
        }.queue()
        return result
    }

    private fun download(url: String, dest: File, ind: ProgressIndicator) {
        val conn = URI(url).toURL().openConnection()
        conn.connectTimeout = 15_000; conn.readTimeout = 60_000
        val total = conn.contentLengthLong.coerceAtLeast(1)
        conn.getInputStream().use { input ->
            dest.outputStream().use { output ->
                val buf = ByteArray(8192); var read: Long = 0; var len: Int
                while (input.read(buf).also { len = it } != -1) {
                    output.write(buf, 0, len); read += len
                    ind.fraction = (read.toDouble() / total) * 0.7
                    if (ind.isCanceled) { dest.delete(); throw InterruptedException("cancelled") }
                }
            }
        }
    }

    private fun extractZip(archive: File, destDir: File) {
        ZipFile(archive).use { zip ->
            val e = zip.entries()
            while (e.hasMoreElements()) {
                val entry = e.nextElement(); val out = File(destDir, entry.name)
                if (entry.isDirectory) out.mkdirs()
                else { out.parentFile?.mkdirs(); zip.getInputStream(entry).use { it.copyTo(out.outputStream()) } }
            }
        }
    }

    private fun extractTarGz(archive: File, destDir: File) {
        val pb = ProcessBuilder("tar", "xzf", archive.absolutePath, "-C", destDir.absolutePath)
        pb.redirectErrorStream(true); val p = pb.start()
        p.inputStream.bufferedReader().forEachLine { log.debug("tar: $it") }
        if (p.waitFor() != 0) throw RuntimeException("tar failed: ${p.exitValue()}")
    }

    private fun isWindows() = System.getProperty("os.name", "").lowercase().contains("win")

    private fun platformOs(): String? {
        val os = System.getProperty("os.name", "").lowercase()
        return when { os.contains("win") -> "win"; os.contains("mac") -> "darwin"; os.contains("linux") -> "linux"; else -> null }
    }

    private fun platformArch(): String? {
        val a = System.getProperty("os.arch", "").lowercase()
        return when { a.contains("aarch64") || a.contains("arm64") -> "arm64"; a.contains("x86_64") || a.contains("amd64") -> "x64"; else -> null }
    }
}
