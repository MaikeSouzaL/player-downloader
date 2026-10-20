package expo.modules.ritmocore

import java.nio.charset.Charset

/**
 * Lê a letra embutida (quadro USLT, ou ULT no ID3v2.2) do cabeçalho ID3v2 de um MP3.
 * Não depende do Android, para poder ser testado na JVM.
 */
object Id3Lyrics {
  /** Tamanho máximo de tag que vale a pena ler (capas grandes ficam no mesmo bloco). */
  const val MAX_TAG_BYTES = 32 * 1024 * 1024

  /** Tamanho total da tag (cabeçalho incluído) a partir dos 10 primeiros bytes, ou -1 se não houver ID3. */
  fun tagSize(header: ByteArray): Int {
    if (header.size < 10 || header[0] != 'I'.code.toByte() || header[1] != 'D'.code.toByte() || header[2] != '3'.code.toByte()) {
      return -1
    }
    return 10 + syncsafe(header, 6)
  }

  fun parse(tag: ByteArray): String? {
    val size = tagSize(tag)
    if (size < 0) return null
    val major = tag[3].toInt()
    val flags = tag[5].toInt() and 0xff
    val end = minOf(size, tag.size)
    var pos = 10

    if ((flags and 0x40) != 0 && major >= 3) {
      val extSize = if (major == 4) syncsafe(tag, pos) else int32(tag, pos) + 4
      pos += extSize
    }

    while (pos + (if (major == 2) 6 else 10) <= end) {
      if (tag[pos].toInt() == 0) break // padding
      val id: String
      val frameSize: Int
      var frameFlags = 0
      if (major == 2) {
        id = String(tag, pos, 3, Charsets.ISO_8859_1)
        frameSize = ((tag[pos + 3].toInt() and 0xff) shl 16) or ((tag[pos + 4].toInt() and 0xff) shl 8) or (tag[pos + 5].toInt() and 0xff)
        pos += 6
      } else {
        id = String(tag, pos, 4, Charsets.ISO_8859_1)
        frameSize = if (major == 4) syncsafe(tag, pos + 4) else int32(tag, pos + 4)
        frameFlags = ((tag[pos + 8].toInt() and 0xff) shl 8) or (tag[pos + 9].toInt() and 0xff)
        pos += 10
      }
      if (frameSize <= 0 || pos + frameSize > end) break

      if (id == "USLT" || id == "ULT") {
        var start = pos
        var length = frameSize
        // ID3v2.4: "data length indicator" adiciona 4 bytes antes do conteúdo.
        if (major == 4 && (frameFlags and 0x0001) != 0) {
          start += 4
          length -= 4
        }
        val compressedOrEncrypted = if (major == 4) (frameFlags and 0x000C) != 0 else (frameFlags and 0x00C0) != 0
        if (!compressedOrEncrypted) decodeUslt(tag, start, length)?.let { return it }
      }
      pos += frameSize
    }
    return null
  }

  private fun decodeUslt(b: ByteArray, start: Int, length: Int): String? {
    if (length < 5) return null
    val encoding = b[start].toInt()
    var p = start + 4 // codificação (1) + idioma (3)
    val end = start + length
    // Pula o "content descriptor", terminado em 0 (ou 00 00 em UTF-16).
    p = if (encoding == 1 || encoding == 2) {
      var i = p
      while (i + 1 < end && !(b[i].toInt() == 0 && b[i + 1].toInt() == 0)) i += 2
      i + 2
    } else {
      var i = p
      while (i < end && b[i].toInt() != 0) i++
      i + 1
    }
    if (p >= end) return null
    val charset: Charset = when (encoding) {
      0 -> Charsets.ISO_8859_1
      1 -> Charsets.UTF_16
      2 -> Charsets.UTF_16BE
      else -> Charsets.UTF_8
    }
    return String(b, p, end - p, charset).trimEnd('\u0000').trim().takeIf { it.isNotEmpty() }
  }

  private fun syncsafe(b: ByteArray, at: Int): Int =
    ((b[at].toInt() and 0x7f) shl 21) or ((b[at + 1].toInt() and 0x7f) shl 14) or
      ((b[at + 2].toInt() and 0x7f) shl 7) or (b[at + 3].toInt() and 0x7f)

  private fun int32(b: ByteArray, at: Int): Int =
    ((b[at].toInt() and 0xff) shl 24) or ((b[at + 1].toInt() and 0xff) shl 16) or
      ((b[at + 2].toInt() and 0xff) shl 8) or (b[at + 3].toInt() and 0xff)
}
