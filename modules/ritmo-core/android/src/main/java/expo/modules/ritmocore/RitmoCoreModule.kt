package expo.modules.ritmocore

import android.app.Activity
import android.app.RecoverableSecurityException
import android.content.ComponentName
import android.content.ContentUris
import android.content.Context
import android.content.IntentSender
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.concurrent.Executor

class TrackItem : Record {
  @Field val id: String = ""
  @Field val uri: String = ""
  @Field val title: String = ""
  @Field val artist: String? = null
  @Field val album: String? = null
  @Field val artworkUri: String? = null
}

class RitmoCoreModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "Contexto do app indisponível", null)

  private val main = Handler(Looper.getMainLooper())
  private val mainExecutor = Executor { main.post(it) }

  private var controllerFuture: ListenableFuture<MediaController>? = null
  private var controller: MediaController? = null
  /** Ações esperando a conexão com o serviço; `promise` é rejeitada se a conexão falhar. */
  private class Pending(val run: (MediaController) -> Unit, val promise: Promise?)
  private val pending = ArrayList<Pending>()

  private var libraryObserver: LibraryObserver? = null

  /** Pedidos de confirmação do Android (lixeira/exclusão) esperando resposta, por requestCode. */
  private class MediaRequest(val promise: Promise, val retryDelete: List<Uri>?)
  private val mediaRequests = HashMap<Int, MediaRequest>()
  private var nextRequestCode = 7300

  /** Com o app em segundo plano o JS só precisa do progresso para somar o tempo ouvido. */
  private var inForeground = true

  private val progressTick = object : Runnable {
    override fun run() {
      val c = controller ?: return
      sendEvent("onProgress", progress(c))
      main.removeCallbacks(this)
      if (c.isPlaying) main.postDelayed(this, if (inForeground) PROGRESS_INTERVAL_MS else BACKGROUND_PROGRESS_INTERVAL_MS)
    }
  }

  private val listener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) {
      if (events.containsAny(
          Player.EVENT_IS_PLAYING_CHANGED,
          Player.EVENT_PLAYBACK_STATE_CHANGED,
          Player.EVENT_MEDIA_ITEM_TRANSITION,
          Player.EVENT_TIMELINE_CHANGED,
          Player.EVENT_SHUFFLE_MODE_ENABLED_CHANGED,
          Player.EVENT_REPEAT_MODE_CHANGED,
          Player.EVENT_PLAYBACK_PARAMETERS_CHANGED,
          Player.EVENT_PLAYER_ERROR,
          Player.EVENT_POSITION_DISCONTINUITY
        )
      ) {
        controller?.let { sendEvent("onState", snapshot(it)) }
      }
      if (events.contains(Player.EVENT_IS_PLAYING_CHANGED)) {
        main.removeCallbacks(progressTick)
        main.post(progressTick)
      }
    }

    override fun onPlayerError(error: PlaybackException) {
      Log.w(TAG, "Erro de reprodução", error)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("RitmoCore")

    Events("onState", "onProgress", "onSleepTimer", "onIssue", "onLibraryChanged", "onShare", "onConvertProgress")

    OnCreate {
      // O mais cedo possível: qualquer crash nativo daqui em diante vai para o relatório.
      appContext.reactContext?.let { CrashCatcher.install(it) }
      main.post {
        connect()
        // O timer e os avisos de erro vivem no processo; o módulo só repassa para o JS.
        PlaybackRuntime.onSleepTimer = { state -> sendEvent("onSleepTimer", state) }
        PlaybackRuntime.onIssue = { issue -> sendEvent("onIssue", issue) }
        appContext.reactContext?.let { ctx ->
          libraryObserver = LibraryObserver(ctx.applicationContext) {
            BrowseTree.invalidate()
            sendEvent("onLibraryChanged", emptyMap<String, Any?>())
          }
            .also { observer -> runCatching { observer.start() }.onFailure { Log.w(TAG, "Observador da biblioteca", it) } }
        }
      }
    }

    OnDestroy {
      main.post {
        PlaybackRuntime.onSleepTimer = null
        PlaybackRuntime.onIssue = null
        libraryObserver?.stop()
        libraryObserver = null
        main.removeCallbacks(progressTick)
        controller?.removeListener(listener)
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controllerFuture = null
        controller = null
      }
    }

    // ------------------------------------------------------------ Compartilhar com o Ritmo

    /** Arquivos/links que abriram o app pelo "Compartilhar" ou "Abrir com" (uma vez só). */
    /** Crash nativo da última vez que o app abriu (ou null). Lê uma vez só. */
    Function("takeLastCrash") { CrashCatcher.take(context) }

    Function("getPendingShare") {
      ShareIntents.parse(context, appContext.currentActivity?.intent)
    }

    OnNewIntent { intent ->
      ShareIntents.parse(context, intent)?.let { sendEvent("onShare", it) }
    }

    /** Copia para Music/Ritmo (áudio) ou Movies/Ritmo (vídeo). Devolve a URI salva. */
    AsyncFunction("saveToLibrary") { uri: String, name: String, mime: String?, kind: String ->
      MediaSaver.save(context, Uri.parse(uri), name, mime, kind).toString()
    }

    // ------------------------------------------------------------ Converter vídeo em áudio

    AsyncFunction("convertToAudio") { jobId: String, uri: String, name: String, bitrateKbps: Int, promise: Promise ->
      AudioConverter.convert(
        context,
        jobId,
        Uri.parse(uri),
        name,
        bitrateKbps,
        onProgress = { p -> sendEvent("onConvertProgress", mapOf("jobId" to jobId, "progress" to p)) },
        onDone = { result ->
          result.fold(
            onSuccess = { promise.resolve(it.toString()) },
            onFailure = { e ->
              val code = if (e is AudioConverter.CancelledException) "ERR_CANCELLED" else "ERR_CONVERT"
              promise.reject(CodedException(code, e.message ?: "Falha ao converter", e))
            }
          )
        }
      )
    }.runOnQueue(Queues.MAIN)

    Function("cancelConversion") { jobId: String -> AudioConverter.cancel(jobId) }

    // ------------------------------------------------------------ Downloads

    Function("startDownload") { url: String, fileName: String, mime: String?, title: String ->
      Downloads.start(context, url, fileName, mime, title).toString()
    }

    Function("queryDownloads") { ids: List<String> ->
      Downloads.query(context, ids.mapNotNull { it.toLongOrNull() })
    }

    Function("cancelDownload") { id: String ->
      id.toLongOrNull()?.let { Downloads.cancel(context, it) }
    }

    Function("deleteLocalFile") { uri: String -> Downloads.deleteLocal(context, uri) }

    // ------------------------------------------------------------ Pasta privada

    AsyncFunction("vaultAdd") { uri: String, meta: Map<String, Any?> ->
      Vault.add(context, Uri.parse(uri), meta)
    }

    AsyncFunction("vaultList") { Vault.list(context) }

    AsyncFunction("vaultRestore") { id: String -> Vault.restore(context, id) }

    AsyncFunction("vaultDelete") { id: String -> Vault.delete(context, id) }

    AsyncFunction("vaultWipe") { Vault.wipe(context) }

    /** Playlists, curtidas, recentes, filtros, edições e textos para o Android Auto (JSON). */
    AsyncFunction("setBrowseData") { json: String ->
      BrowseTree.save(context, json)
    }

    OnActivityEntersForeground {
      main.post {
        inForeground = true
        main.removeCallbacks(progressTick)
        main.post(progressTick)
      }
    }

    OnActivityEntersBackground {
      main.post { inForeground = false }
    }

    OnActivityResult { _, payload ->
      val request = mediaRequests.remove(payload.requestCode) ?: return@OnActivityResult
      val ok = payload.resultCode == Activity.RESULT_OK
      // Android 10: depois de autorizar, a exclusão precisa ser feita de novo pelo app.
      if (ok && request.retryDelete != null) deleteDirectly(request.retryDelete, request.promise)
      else request.promise.resolve(ok)
    }

    // ------------------------------------------------------- biblioteca

    AsyncFunction("queryAudio") { MediaLibrary.audio(context) }

    AsyncFunction("queryVideos") { MediaLibrary.videos(context) }

    AsyncFunction("getArtwork") { albumId: String, trackUri: String?, size: Int ->
      MediaLibrary.artwork(context, albumId, trackUri, size)
    }

    AsyncFunction("getVideoThumbnail") { videoId: String, size: Int ->
      MediaLibrary.videoThumbnail(context, videoId, size)
    }

    AsyncFunction("clearArtworkCache") { MediaLibrary.clearCache(context) }

    AsyncFunction("queryTrashed") { MediaLibrary.trashed(context) }

    /** Android 11+ tem lixeira do sistema (30 dias); antes disso só dá para excluir de vez. */
    Function("supportsTrash") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.R }

    /** trash=true move para a lixeira; false restaura. O Android pede confirmação ao usuário. */
    AsyncFunction("trashTracks") { ids: List<String>, trash: Boolean, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
        promise.reject(CodedException("ERR_UNSUPPORTED", "A lixeira de músicas precisa do Android 11 ou mais novo", null))
        return@AsyncFunction
      }
      val uris = audioUris(ids)
      if (uris.isEmpty()) return@AsyncFunction promise.resolve(false)
      launchRequest(MediaStore.createTrashRequest(context.contentResolver, uris, trash).intentSender, promise, null)
    }.runOnQueue(Queues.MAIN)

    /** Exclui de vez (com a confirmação do Android). */
    AsyncFunction("deleteTracks") { ids: List<String>, promise: Promise ->
      val uris = audioUris(ids)
      if (uris.isEmpty()) return@AsyncFunction promise.resolve(false)
      when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
          launchRequest(MediaStore.createDeleteRequest(context.contentResolver, uris).intentSender, promise, null)
        Build.VERSION.SDK_INT == Build.VERSION_CODES.Q -> deleteDirectly(uris, promise)
        else -> promise.reject(CodedException("ERR_UNSUPPORTED", "Excluir músicas precisa do Android 10 ou mais novo. Use “Esconder”.", null))
      }
    }.runOnQueue(Queues.MAIN)

    /** Apaga itens pela URI do MediaStore (vídeos e músicas), com a confirmação do Android. */
    AsyncFunction("deleteUris") { list: List<String>, promise: Promise ->
      val uris = list.map { Uri.parse(it) }.filter { it.scheme == "content" }
      if (uris.isEmpty()) return@AsyncFunction promise.resolve(false)
      when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
          launchRequest(MediaStore.createDeleteRequest(context.contentResolver, uris).intentSender, promise, null)
        else -> deleteDirectly(uris, promise)
      }
    }.runOnQueue(Queues.MAIN)

    /** URIs (content://) que ainda existem no MediaStore. */
    AsyncFunction("existingUris") { list: List<String> ->
      list.filter { raw ->
        // Só o MediaStore dá para conferir; o resto conta como existente (desfazer duplica, não perde).
        if (Uri.parse(raw).scheme != "content") return@filter true
        runCatching {
          context.contentResolver.query(Uri.parse(raw), arrayOf(MediaStore.MediaColumns._ID), null, null, null)?.use { it.count > 0 } ?: false
        }.getOrDefault(true)
      }
    }

    // ------------------------------------------------------- aparelho

    Function("canWriteSettings") { DeviceActions.canWriteSettings(context) }

    Function("openWriteSettings") { DeviceActions.openWriteSettings(context) }

    AsyncFunction("setRingtone") { trackId: String, type: String -> DeviceActions.setRingtone(context, trackId, type) }

    Function("getOutputDevice") { DeviceActions.outputDevice(context) }

    /** Letra: primeiro um .lrc com o mesmo nome do arquivo, depois a letra embutida no MP3 (ID3 USLT). */
    AsyncFunction("readLyrics") { path: String?, uri: String ->
      lrcBeside(path)?.let { return@AsyncFunction mapOf("source" to "lrc", "text" to it) }
      embeddedLyrics(Uri.parse(uri))?.let { return@AsyncFunction mapOf("source" to "embedded", "text" to it) }
      null
    }

    // ---------------------------------------------------------- reprodução

    AsyncFunction("setQueue") { items: List<TrackItem>, startIndex: Int, startPositionMs: Double, play: Boolean, promise: Promise ->
      withController(promise) { c ->
        c.setMediaItems(items.map(::toMediaItem), startIndex.coerceIn(0, maxOf(0, items.size - 1)), startPositionMs.toLong())
        c.prepare()
        if (play) c.play()
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("addToQueue") { items: List<TrackItem>, playNext: Boolean, promise: Promise ->
      withController(promise) { c ->
        val mediaItems = items.map(::toMediaItem)
        if (c.mediaItemCount == 0) {
          c.setMediaItems(mediaItems)
          c.prepare()
        } else if (playNext) {
          c.addMediaItems(c.currentMediaItemIndex + 1, mediaItems)
        } else {
          c.addMediaItems(mediaItems)
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("removeFromQueue") { index: Int, promise: Promise ->
      withController(promise) { c -> if (index in 0 until c.mediaItemCount) c.removeMediaItem(index) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("moveInQueue") { from: Int, to: Int, promise: Promise ->
      withController(promise) { c ->
        if (from in 0 until c.mediaItemCount && to in 0 until c.mediaItemCount) c.moveMediaItem(from, to)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("play") { promise: Promise ->
      withController(promise) { c ->
        if (c.playbackState == Player.STATE_IDLE) c.prepare()
        if (c.playbackState == Player.STATE_ENDED) c.seekToDefaultPosition(0)
        c.play()
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("pause") { promise: Promise -> withController(promise) { it.pause() } }.runOnQueue(Queues.MAIN)

    AsyncFunction("seekTo") { positionMs: Double, promise: Promise ->
      withController(promise) { it.seekTo(positionMs.toLong()) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("skipTo") { index: Int, promise: Promise ->
      withController(promise) { c ->
        if (index in 0 until c.mediaItemCount) {
          c.seekToDefaultPosition(index)
          c.play()
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("next") { promise: Promise -> withController(promise) { it.seekToNextMediaItem() } }.runOnQueue(Queues.MAIN)

    /** Volta ao começo se já tocou mais de 3 s; senão vai para a anterior (como o media3 faz). */
    AsyncFunction("previous") { promise: Promise -> withController(promise) { it.seekToPrevious() } }.runOnQueue(Queues.MAIN)

    AsyncFunction("setShuffle") { enabled: Boolean, promise: Promise ->
      withController(promise) { it.shuffleModeEnabled = enabled }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setRepeat") { mode: String, promise: Promise ->
      withController(promise) {
        it.repeatMode = when (mode) {
          "one" -> Player.REPEAT_MODE_ONE
          "all" -> Player.REPEAT_MODE_ALL
          else -> Player.REPEAT_MODE_OFF
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setSpeed") { speed: Double, promise: Promise ->
      withController(promise) { it.setPlaybackSpeed(speed.toFloat().coerceIn(0.25f, 3f)) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getState") { promise: Promise ->
      withControllerResult(promise) { snapshot(it) }
    }.runOnQueue(Queues.MAIN)

    /** IDs da fila na ordem original e a ordem real de reprodução (que muda no modo aleatório). */
    // Espera a conexão: com o app reaberto e música tocando, a fila do serviço é a verdade.
    AsyncFunction("getQueue") { promise: Promise ->
      withControllerResult(promise) { c ->
        mapOf(
          "ids" to (0 until c.mediaItemCount).map { c.getMediaItemAt(it).mediaId },
          "order" to playOrder(c),
          "index" to c.currentMediaItemIndex
        )
      }
    }.runOnQueue(Queues.MAIN)

    // ------------------------------------------------------- equalizador

    AsyncFunction("getEqualizer") { AudioEffects.info() }

    AsyncFunction("setEqualizerEnabled") { enabled: Boolean ->
      AudioEffects.setEnabled(enabled)
      AudioEffects.info()
    }

    AsyncFunction("setEqualizerBand") { band: Int, level: Int ->
      AudioEffects.setBandLevel(band, level)
      AudioEffects.info()
    }

    AsyncFunction("applyEqualizerPreset") { preset: Int ->
      AudioEffects.usePreset(preset)
      AudioEffects.info()
    }

    AsyncFunction("setBassBoost") { strength: Int ->
      AudioEffects.setBassBoost(strength)
      AudioEffects.info()
    }

    AsyncFunction("setLoudness") { gainMb: Int ->
      AudioEffects.setLoudness(gainMb)
      AudioEffects.info()
    }

    AsyncFunction("restoreEqualizer") { enabled: Boolean, levels: List<Int>?, preset: Int, bass: Int, loudness: Int ->
      AudioEffects.restore(enabled, levels, preset, bass, loudness)
      AudioEffects.info()
    }

    // ------------------------------------------------------ timer para dormir

    AsyncFunction("setSleepTimer") { minutes: Double, endOfTrack: Boolean ->
      PlaybackRuntime.setSleepTimer(minutes, endOfTrack)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getSleepTimer") { PlaybackRuntime.sleepState(fired = false) }.runOnQueue(Queues.MAIN)

    // ------------------------------------------------------- fila salva

    /** Recarrega a última fila salva pelo serviço (só se o player estiver vazio). Devolve se restaurou. */
    AsyncFunction("restoreSavedQueue") { play: Boolean, promise: Promise ->
      withControllerResult(promise) { c ->
        if (c.mediaItemCount > 0) return@withControllerResult false
        val saved = QueueStore.load(context) ?: return@withControllerResult false
        c.shuffleModeEnabled = saved.state.shuffle
        c.repeatMode = saved.state.repeat
        c.setPlaybackSpeed(saved.state.speed)
        c.setMediaItems(saved.items.map { PlaybackService.fromStored(it) }, saved.state.index, saved.state.positionMs)
        c.prepare()
        if (play) c.play()
        true
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearSavedQueue") { QueueStore.clear(context) }
  }

  // ------------------------------------------------------------ controller

  private fun connect() {
    if (controllerFuture != null) return
    val ctx = appContext.reactContext ?: return
    val token = SessionToken(ctx, ComponentName(ctx, PlaybackService::class.java))
    val future = MediaController.Builder(ctx, token).buildAsync()
    controllerFuture = future
    future.addListener({
      try {
        val c = future.get()
        controller = c
        c.addListener(listener)
        val queued = ArrayList(pending)
        pending.clear()
        for (item in queued) item.run(c)
        sendEvent("onState", snapshot(c))
        main.post(progressTick)
      } catch (e: Exception) {
        Log.e(TAG, "Não foi possível conectar ao serviço de reprodução", e)
        controllerFuture = null
        val queued = ArrayList(pending)
        pending.clear()
        for (item in queued) item.promise?.reject(CodedException("ERR_PLAYER", "Player indisponível: ${e.message}", e))
      }
    }, mainExecutor)
  }

  private fun withController(promise: Promise?, action: (MediaController) -> Unit) {
    enqueue(Pending({ c -> runAction(c, action, promise) }, promise))
  }

  /** Como withController, mas resolve a promise com o resultado do bloco. */
  private fun <T> withControllerResult(promise: Promise, block: (MediaController) -> T) {
    enqueue(Pending({ c ->
      try {
        promise.resolve(block(c))
      } catch (e: Exception) {
        promise.reject(CodedException("ERR_PLAYER", e.message ?: "Falha no player", e))
      }
    }, promise))
  }

  private fun enqueue(item: Pending) {
    val c = controller
    if (c != null) {
      item.run(c)
    } else {
      pending += item
      connect()
    }
  }

  private fun runAction(c: MediaController, action: (MediaController) -> Unit, promise: Promise?) {
    try {
      action(c)
      promise?.resolve(null)
    } catch (e: Exception) {
      promise?.reject(CodedException("ERR_PLAYER", e.message ?: "Falha no player", e))
    }
  }

  private fun toMediaItem(item: TrackItem): MediaItem {
    val metadata = MediaMetadata.Builder()
      .setTitle(item.title)
      .setArtist(item.artist)
      .setAlbumTitle(item.album)
      .apply { item.artworkUri?.let { setArtworkUri(Uri.parse(it)) } }
      .build()
    return MediaItem.Builder()
      .setMediaId(item.id)
      .setUri(item.uri)
      .setMediaMetadata(metadata)
      .build()
  }

  private fun snapshot(c: MediaController): Map<String, Any?> = mapOf(
    "isPlaying" to c.isPlaying,
    "playWhenReady" to c.playWhenReady,
    "state" to when (c.playbackState) {
      Player.STATE_BUFFERING -> "buffering"
      Player.STATE_READY -> "ready"
      Player.STATE_ENDED -> "ended"
      else -> "idle"
    },
    "index" to c.currentMediaItemIndex,
    "mediaId" to c.currentMediaItem?.mediaId,
    "position" to c.currentPosition.toDouble(),
    "duration" to (c.duration.takeIf { it != C.TIME_UNSET } ?: 0L).toDouble(),
    "shuffle" to c.shuffleModeEnabled,
    "repeat" to when (c.repeatMode) {
      Player.REPEAT_MODE_ONE -> "one"
      Player.REPEAT_MODE_ALL -> "all"
      else -> "off"
    },
    "speed" to c.playbackParameters.speed.toDouble(),
    "queueLength" to c.mediaItemCount,
    "error" to c.playerError?.let { it.message ?: it.errorCodeName }
  )

  private fun progress(c: MediaController): Map<String, Any?> = mapOf(
    "mediaId" to c.currentMediaItem?.mediaId,
    "position" to c.currentPosition.toDouble(),
    "duration" to (c.duration.takeIf { it != C.TIME_UNSET } ?: 0L).toDouble(),
    "buffered" to c.bufferedPosition.toDouble()
  )

  private fun playOrder(c: MediaController): List<Int> {
    val timeline = c.currentTimeline
    if (timeline.isEmpty) return emptyList()
    val order = ArrayList<Int>(timeline.windowCount)
    var i = timeline.getFirstWindowIndex(c.shuffleModeEnabled)
    while (i != C.INDEX_UNSET && order.size < timeline.windowCount) {
      order += i
      i = timeline.getNextWindowIndex(i, Player.REPEAT_MODE_OFF, c.shuffleModeEnabled)
    }
    return order
  }

  // ------------------------------------------------------ exclusão/lixeira

  private fun audioUris(ids: List<String>): List<Uri> =
    ids.mapNotNull { it.toLongOrNull() }.map { ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, it) }

  private fun launchRequest(sender: IntentSender, promise: Promise, retryDelete: List<Uri>?) {
    val activity = appContext.currentActivity
    if (activity == null) {
      promise.reject(CodedException("ERR_NO_ACTIVITY", "Abra o app para confirmar", null))
      return
    }
    val code = nextRequestCode++
    mediaRequests[code] = MediaRequest(promise, retryDelete)
    try {
      activity.startIntentSenderForResult(sender, code, null, 0, 0, 0)
    } catch (e: IntentSender.SendIntentException) {
      mediaRequests.remove(code)
      promise.reject(CodedException("ERR_REQUEST", "Não foi possível pedir a confirmação", e))
    }
  }

  /** Android 10: apaga um a um; se o sistema pedir autorização, mostra o pedido e tenta de novo depois. */
  private fun deleteDirectly(uris: List<Uri>, promise: Promise) {
    val resolver = context.contentResolver
    for ((i, uri) in uris.withIndex()) {
      try {
        resolver.delete(uri, null, null)
      } catch (e: SecurityException) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && e is RecoverableSecurityException) {
          launchRequest(e.userAction.actionIntent.intentSender, promise, uris.drop(i))
        } else {
          promise.reject(CodedException("ERR_DELETE", "Sem permissão para excluir este arquivo", e))
        }
        return
      }
    }
    promise.resolve(true)
  }

  // ---------------------------------------------------------------- letras

  private fun lrcBeside(path: String?): String? {
    if (path.isNullOrBlank()) return null
    val audio = File(path)
    val base = audio.nameWithoutExtension
    val candidates = listOf(File(audio.parentFile, "$base.lrc"), File(audio.parentFile, "$base.LRC"))
    return candidates.firstNotNullOfOrNull { f ->
      runCatching { if (f.canRead()) f.readText().takeIf { it.isNotBlank() } else null }.getOrNull()
    }
  }

  private fun embeddedLyrics(uri: Uri): String? = runCatching {
    context.contentResolver.openInputStream(uri)?.use { input ->
      val header = ByteArray(10)
      if (input.read(header) != 10) return@use null
      val size = Id3Lyrics.tagSize(header)
      if (size <= 10 || size > Id3Lyrics.MAX_TAG_BYTES) return@use null
      val tag = ByteArray(size)
      System.arraycopy(header, 0, tag, 0, 10)
      var read = 10
      while (read < size) {
        val n = input.read(tag, read, size - read)
        if (n <= 0) break
        read += n
      }
      Id3Lyrics.parse(if (read == size) tag else tag.copyOf(read))
    }
  }.getOrNull()

  companion object {
    private const val TAG = "RitmoCore"
    private const val PROGRESS_INTERVAL_MS = 500L
    private const val BACKGROUND_PROGRESS_INTERVAL_MS = 10_000L
  }
}
