package expo.modules.ritmocore

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.AudioEncoderSettings
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Converte vídeo (ou áudio) do aparelho em música AAC/M4A.
 *  - bitrate 0 ("Original"): copia a faixa de áudio que já está no vídeo, sem recodificar (rápido e sem perda),
 *    quando ela é AAC; senão recodifica a 192 kbps.
 *  - 96/128/192/256 kbps: recodifica com o Transformer do media3 nessa qualidade.
 * O resultado vai para Music/Player Downloader pela MediaSaver. Progresso de 0 a 100 pelo callback.
 */
@UnstableApi
object AudioConverter {
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()

  class CancelledException : Exception("Conversão cancelada")

  /** Estado de uma conversão: termina uma vez só (sucesso, erro ou cancelada). */
  private class Job(val id: String, val temps: List<File>, val onDone: (Result<Uri>) -> Unit) {
    val finished = AtomicBoolean(false)
    @Volatile var cancelled = false
    @Volatile var transformer: Transformer? = null
    @Volatile var poll: Runnable? = null
  }

  private val jobs = ConcurrentHashMap<String, Job>()

  fun convert(
    context: Context,
    jobId: String,
    source: Uri,
    outName: String,
    bitrateKbps: Int,
    onProgress: (Int) -> Unit,
    onDone: (Result<Uri>) -> Unit
  ) {
    val app = context.applicationContext
    val dir = File(app.cacheDir, "convert").apply { mkdirs() }
    val temp = File(dir, "$jobId.m4a")
    val input = File(dir, "$jobId.src")
    val job = Job(jobId, listOf(temp, input), onDone)
    jobs[jobId] = job
    io.execute {
      // Provedores que entregam um "pipe" (sem posição) não funcionam com o MediaExtractor/Transformer:
      // o que não é do MediaStore é copiado para o cache antes.
      val readable = runCatching {
        if (source.scheme == "content" && source.authority != "media") {
          MediaSaver.copyToFile(app, source, input)
          Uri.fromFile(input)
        } else {
          source
        }
      }
      val src = readable.getOrElse {
        complete(app, job, outName, Result.failure(it))
        return@execute
      }
      if (job.cancelled) return@execute complete(app, job, outName, Result.failure(CancelledException()))
      if (bitrateKbps <= 0) {
        val copied = runCatching { remuxAac(app, job, src, temp, onProgress) }
        when {
          copied.getOrNull() == true -> complete(app, job, outName, Result.success(temp))
          copied.exceptionOrNull() is CancelledException -> complete(app, job, outName, Result.failure(CancelledException()))
          // Áudio do vídeo não é AAC (ou não deu para copiar): recodifica numa qualidade alta.
          else -> main.post { transcode(app, job, src, temp, outName, 192, onProgress) }
        }
      } else {
        main.post { transcode(app, job, src, temp, outName, bitrateKbps, onProgress) }
      }
    }
  }

  /** Cancelar: o Transformer do media3 1.9 não chama o listener no cancelamento, então terminamos aqui. */
  fun cancel(jobId: String) {
    val job = jobs[jobId] ?: return
    job.cancelled = true
    main.post {
      job.poll?.let { main.removeCallbacks(it) }
      job.transformer?.let { t ->
        job.transformer = null
        runCatching { t.cancel() }
        complete(null, job, "", Result.failure(CancelledException()))
      }
    }
  }

  /** Salva na biblioteca (fora da thread principal), apaga os temporários e avisa o JS uma única vez. */
  private fun complete(context: Context?, job: Job, outName: String, result: Result<File>) {
    if (!job.finished.compareAndSet(false, true)) return
    job.poll?.let { main.removeCallbacks(it) }
    io.execute {
      val saved = result.mapCatching { file ->
        if (job.cancelled) throw CancelledException()
        MediaSaver.save(context ?: throw IllegalStateException("sem contexto"), Uri.fromFile(file), outName, "audio/mp4", "audio")
      }
      job.temps.forEach { it.delete() }
      jobs.remove(job.id)
      main.post { job.onDone(saved) }
    }
  }

  /** Copia a faixa AAC para um .m4a. Devolve false se a faixa não for AAC (aí o chamador recodifica). */
  private fun remuxAac(context: Context, job: Job, source: Uri, out: File, onProgress: (Int) -> Unit): Boolean {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(context, source, null)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: throw IllegalStateException("O arquivo não tem áudio")
      val format = extractor.getTrackFormat(track)
      if (format.getString(MediaFormat.KEY_MIME) != MimeTypes.AUDIO_AAC) return false
      val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
      extractor.selectTrack(track)
      val muxer = MediaMuxer(out.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      try {
        val dst = muxer.addTrack(format)
        muxer.start()
        val size = if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else 0
        val buffer = ByteBuffer.allocate(maxOf(size, 1 shl 20))
        val info = MediaCodec.BufferInfo()
        var lastPercent = -1
        while (true) {
          if (job.cancelled) throw CancelledException()
          val read = extractor.readSampleData(buffer, 0)
          if (read < 0) break
          info.offset = 0
          info.size = read
          info.presentationTimeUs = extractor.sampleTime
          info.flags = if ((extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
          muxer.writeSampleData(dst, buffer, info)
          extractor.advance()
          if (durationUs > 0) {
            val percent = (info.presentationTimeUs * 100 / durationUs).toInt().coerceIn(0, 99)
            if (percent != lastPercent) {
              lastPercent = percent
              main.post { onProgress(percent) }
            }
          }
        }
        muxer.stop()
      } finally {
        runCatching { muxer.release() }
      }
      return true
    } finally {
      extractor.release()
    }
  }

  /** Recodifica para AAC no bitrate pedido (thread principal: o Transformer exige um Looper). */
  private fun transcode(
    context: Context,
    job: Job,
    source: Uri,
    out: File,
    outName: String,
    bitrateKbps: Int,
    onProgress: (Int) -> Unit
  ) {
    if (job.cancelled) {
      complete(context, job, outName, Result.failure(CancelledException()))
      return
    }
    out.delete()
    val encoder = DefaultEncoderFactory.Builder(context)
      .setRequestedAudioEncoderSettings(AudioEncoderSettings.Builder().setBitrate(bitrateKbps * 1000).build())
      .build()
    val progress = ProgressHolder()
    val transformer = Transformer.Builder(context)
      .setAudioMimeType(MimeTypes.AUDIO_AAC)
      .setEncoderFactory(encoder)
      .addListener(object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          job.transformer = null
          complete(context, job, outName, Result.success(out))
        }

        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
          job.transformer = null
          complete(context, job, outName, Result.failure(if (job.cancelled) CancelledException() else exportException))
        }
      })
      .build()
    job.transformer = transformer
    val poll = object : Runnable {
      override fun run() {
        if (job.finished.get()) return
        if (transformer.getProgress(progress) == Transformer.PROGRESS_STATE_AVAILABLE) onProgress(progress.progress.coerceIn(0, 99))
        main.postDelayed(this, 500)
      }
    }
    job.poll = poll
    val item = EditedMediaItem.Builder(MediaItem.fromUri(source)).setRemoveVideo(true).build()
    try {
      transformer.start(item, out.path)
      main.postDelayed(poll, 500)
    } catch (e: Exception) {
      job.transformer = null
      complete(context, job, outName, Result.failure(e))
    }
  }
}
