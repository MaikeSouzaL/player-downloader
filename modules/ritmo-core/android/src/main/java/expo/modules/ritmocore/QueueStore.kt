package expo.modules.ritmocore

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Fila salva no aparelho para retomar a reprodução com o app fechado (fone Bluetooth,
 * notificação de retomada do Android) e ao reabrir o app.
 * A lista de faixas só é regravada quando muda; índice e posição são salvos com frequência.
 */
object QueueStore {
  data class Item(
    val id: String,
    val uri: String,
    val title: String,
    val artist: String?,
    val album: String?,
    val artworkUri: String?
  )

  data class State(val index: Int, val positionMs: Long, val shuffle: Boolean, val repeat: Int, val speed: Float)

  data class Saved(val items: List<Item>, val state: State)

  private const val PREFS = "ritmo_queue"
  private const val KEY_ITEMS = "items"
  private const val KEY_STATE = "state"

  fun encodeItems(items: List<Item>): String {
    val array = JSONArray()
    for (item in items) {
      array.put(
        JSONObject()
          .put("id", item.id)
          .put("uri", item.uri)
          .put("title", item.title)
          .putOpt("artist", item.artist)
          .putOpt("album", item.album)
          .putOpt("art", item.artworkUri)
      )
    }
    return array.toString()
  }

  fun decodeItems(json: String?): List<Item> {
    if (json.isNullOrBlank()) return emptyList()
    return try {
      val array = JSONArray(json)
      (0 until array.length()).mapNotNull { i ->
        val o = array.optJSONObject(i) ?: return@mapNotNull null
        val id = o.optString("id")
        val uri = o.optString("uri")
        if (id.isEmpty() || uri.isEmpty()) return@mapNotNull null
        Item(id, uri, o.optString("title", id), o.optStringOrNull("artist"), o.optStringOrNull("album"), o.optStringOrNull("art"))
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  fun encodeState(state: State): String =
    JSONObject()
      .put("index", state.index)
      .put("position", state.positionMs)
      .put("shuffle", state.shuffle)
      .put("repeat", state.repeat)
      .put("speed", state.speed.toDouble())
      .toString()

  fun decodeState(json: String?): State {
    if (json.isNullOrBlank()) return State(0, 0, false, 0, 1f)
    return try {
      val o = JSONObject(json)
      State(
        o.optInt("index", 0).coerceAtLeast(0),
        o.optLong("position", 0).coerceAtLeast(0),
        o.optBoolean("shuffle", false),
        o.optInt("repeat", 0),
        o.optDouble("speed", 1.0).toFloat().takeIf { it in 0.25f..3f } ?: 1f
      )
    } catch (_: Exception) {
      State(0, 0, false, 0, 1f)
    }
  }

  fun saveItems(context: Context, items: List<Item>) {
    prefs(context).edit().putString(KEY_ITEMS, encodeItems(items)).apply()
  }

  fun saveState(context: Context, state: State) {
    prefs(context).edit().putString(KEY_STATE, encodeState(state)).apply()
  }

  fun load(context: Context): Saved? {
    val p = prefs(context)
    val items = decodeItems(p.getString(KEY_ITEMS, null))
    if (items.isEmpty()) return null
    val state = decodeState(p.getString(KEY_STATE, null))
    return Saved(items, state.copy(index = state.index.coerceIn(0, items.size - 1)))
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun JSONObject.optStringOrNull(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotEmpty() } else null
}
