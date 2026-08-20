package com.harbor.agents

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.diagnostic.Logger
import java.util.concurrent.ConcurrentHashMap

/**
 * Host-side blob cache for images that never fit through JCEF JSQuery.
 * Clipboard / picker / drop already have the bytes; the webview send payload
 * only carries attachment ids so the sidecar can hydrate them.
 */
object HarborAttachmentStore {
  private val log = Logger.getInstance(HarborAttachmentStore::class.java)
  private const val MAX_ITEMS = 32
  private val byId = ConcurrentHashMap<String, Map<String, Any>>()
  private val order = java.util.concurrent.ConcurrentLinkedDeque<String>()

  fun remember(list: List<Map<String, Any>>) {
    for (item in list) {
      val id = item["id"] as? String ?: continue
      val data = item["dataBase64"] as? String
      if (data.isNullOrBlank()) {
        continue
      }
      byId[id] = item
      order.remove(id)
      order.addLast(id)
    }
    while (order.size > MAX_ITEMS) {
      val old = order.pollFirst() ?: break
      byId.remove(old)
    }
  }

  fun rememberFromHostJson(json: String) {
    try {
      val el = JsonParser.parseString(json)
      if (!el.isJsonObject) {
        return
      }
      val obj = el.asJsonObject
      if (obj.get("type")?.asString != "attachmentsAdded") {
        return
      }
      val arr = obj.getAsJsonArray("attachments") ?: return
      rememberJsonArray(arr)
    } catch (t: Throwable) {
      log.warn("Harbor attachment cache parse failed", t)
    }
  }

  fun hydrateSend(obj: JsonObject) {
    val arr = obj.getAsJsonArray("attachments") ?: return
    var filled = 0
    var missing = 0
    for (el in arr) {
      if (!el.isJsonObject) {
        continue
      }
      val item = el.asJsonObject
      if (item.get("dataBase64")?.asString?.isNotBlank() == true) {
        rememberJsonArray(JsonArray().also { it.add(item) })
        continue
      }
      val id = item.get("id")?.asString
      if (id.isNullOrBlank()) {
        continue
      }
      val cached = byId[id]
      val data = cached?.get("dataBase64") as? String
      if (data.isNullOrBlank()) {
        val storageKey = item.get("storageKey")?.asString
        if (!storageKey.isNullOrBlank()) {
          continue
        }
        missing += 1
        continue
      }
      item.addProperty("dataBase64", data)
      val kind = cached["kind"] as? String
      if (item.get("kind")?.asString.isNullOrBlank() && !kind.isNullOrBlank()) {
        item.addProperty("kind", kind)
      }
      val mime = cached["mime"] as? String
      if (item.get("mime")?.asString.isNullOrBlank() && !mime.isNullOrBlank()) {
        item.addProperty("mime", mime)
      }
      val name = cached["name"] as? String
      if (item.get("name")?.asString.isNullOrBlank() && !name.isNullOrBlank()) {
        item.addProperty("name", name)
      }
      filled += 1
    }
    if (filled > 0 || missing > 0) {
      log.info("Harbor attachment hydrate filled=$filled missing=$missing")
    }
  }

  private fun rememberJsonArray(arr: JsonArray) {
    val list = mutableListOf<Map<String, Any>>()
    for (el in arr) {
      if (!el.isJsonObject) {
        continue
      }
      val item = el.asJsonObject
      val id = item.get("id")?.asString ?: continue
      val data = item.get("dataBase64")?.asString ?: continue
      if (data.isBlank()) {
        continue
      }
      val map = mutableMapOf<String, Any>(
        "id" to id,
        "dataBase64" to data,
      )
      item.get("kind")?.asString?.let { map["kind"] = it }
      item.get("name")?.asString?.let { map["name"] = it }
      item.get("mime")?.asString?.let { map["mime"] = it }
      list.add(map)
    }
    if (list.isNotEmpty()) {
      remember(list)
    }
  }
}
