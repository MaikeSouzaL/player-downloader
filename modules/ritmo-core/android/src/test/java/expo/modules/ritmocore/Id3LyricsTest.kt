package expo.modules.ritmocore

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.ByteArrayOutputStream

class Id3LyricsTest {

  private fun syncsafe(n: Int) = byteArrayOf(
    ((n shr 21) and 0x7f).toByte(), ((n shr 14) and 0x7f).toByte(), ((n shr 7) and 0x7f).toByte(), (n and 0x7f).toByte()
  )

  private fun int32(n: Int) = byteArrayOf((n shr 24).toByte(), (n shr 16).toByte(), (n shr 8).toByte(), n.toByte())

  private fun frame(major: Int, id: String, body: ByteArray): ByteArray {
    val out = ByteArrayOutputStream()
    out.write(id.toByteArray(Charsets.ISO_8859_1))
    out.write(if (major == 4) syncsafe(body.size) else int32(body.size))
    out.write(byteArrayOf(0, 0))
    out.write(body)
    return out.toByteArray()
  }

  private fun tag(major: Int, vararg frames: ByteArray, padding: Int = 16): ByteArray {
    val content = ByteArrayOutputStream().apply { frames.forEach { write(it) }; write(ByteArray(padding)) }.toByteArray()
    return byteArrayOf('I'.code.toByte(), 'D'.code.toByte(), '3'.code.toByte(), major.toByte(), 0, 0) + syncsafe(content.size) + content
  }

  private fun uslt(encoding: Int, descriptor: ByteArray, text: ByteArray) =
    byteArrayOf(encoding.toByte()) + "por".toByteArray() + descriptor + text

  @Test
  fun readsUtf8LyricsFromV24() {
    val lyrics = "[00:01.00]Primeira linha\n[00:05.50]Ação e coração"
    val data = tag(4, frame(4, "TIT2", byteArrayOf(3) + "Título".toByteArray()), frame(4, "USLT", uslt(3, byteArrayOf(0), lyrics.toByteArray())))
    assertEquals(lyrics, Id3Lyrics.parse(data))
  }

  @Test
  fun readsUtf16WithBomFromV23() {
    val lyrics = "Letra em UTF-16"
    val text = lyrics.toByteArray(Charsets.UTF_16) // com BOM
    val descriptor = byteArrayOf(0xFF.toByte(), 0xFE.toByte(), 0, 0) // descritor vazio com BOM
    val data = tag(3, frame(3, "USLT", uslt(1, descriptor, text)))
    assertEquals(lyrics, Id3Lyrics.parse(data))
  }

  @Test
  fun readsLatin1() {
    val data = tag(3, frame(3, "USLT", uslt(0, "desc".toByteArray() + byteArrayOf(0), "Olá".toByteArray(Charsets.ISO_8859_1))))
    assertEquals("Olá", Id3Lyrics.parse(data))
  }

  @Test
  fun returnsNullWithoutLyricsOrTag() {
    assertNull(Id3Lyrics.parse(tag(4, frame(4, "TIT2", byteArrayOf(3) + "x".toByteArray()))))
    assertNull(Id3Lyrics.parse("not an id3 tag at all".toByteArray()))
    assertEquals(-1, Id3Lyrics.tagSize(ByteArray(10)))
  }

  @Test
  fun tagSizeIncludesHeader() {
    val data = tag(4, frame(4, "USLT", uslt(3, byteArrayOf(0), "a".toByteArray())), padding = 0)
    assertEquals(data.size, Id3Lyrics.tagSize(data.copyOf(10)))
  }
}
