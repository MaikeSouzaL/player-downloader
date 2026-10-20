package expo.modules.ritmocore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueStoreTest {
  private val items = listOf(
    QueueStore.Item("1", "content://media/external/audio/media/1", "Música 1", "Artista", "Álbum", "ritmo-art://album/10?track=x"),
    QueueStore.Item("2", "content://media/external/audio/media/2", "Sem artista", null, null, null)
  )

  @Test
  fun itemsRoundTrip() {
    val decoded = QueueStore.decodeItems(QueueStore.encodeItems(items))
    assertEquals(items, decoded)
  }

  @Test
  fun stateRoundTrip() {
    val state = QueueStore.State(index = 1, positionMs = 61_500, shuffle = true, repeat = 2, speed = 1.25f)
    assertEquals(state, QueueStore.decodeState(QueueStore.encodeState(state)))
  }

  @Test
  fun corruptedDataFallsBackSafely() {
    assertTrue(QueueStore.decodeItems("{not json").isEmpty())
    assertTrue(QueueStore.decodeItems(null).isEmpty())
    assertTrue(QueueStore.decodeItems("""[{"id":"","uri":"x"},{"id":"3"},{"id":"4","uri":"u","title":"ok"}]""").size == 1)
    val state = QueueStore.decodeState("""{"index":-5,"position":-1,"speed":99}""")
    assertEquals(0, state.index)
    assertEquals(0L, state.positionMs)
    assertEquals(1f, state.speed)
    assertEquals(QueueStore.State(0, 0, false, 0, 1f), QueueStore.decodeState("lixo"))
  }

  @Test
  fun missingTitleUsesId() {
    val decoded = QueueStore.decodeItems("""[{"id":"7","uri":"content://x/7"}]""")
    assertEquals("7", decoded.single().title)
    assertNull(decoded.single().artist)
  }
}
