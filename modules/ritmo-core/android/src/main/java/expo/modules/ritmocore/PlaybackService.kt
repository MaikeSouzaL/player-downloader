package expo.modules.ritmocore

import android.app.PendingIntent
import android.content.ContentUris
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionError
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.ListeningExecutorService
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Serviço de reprodução em primeiro plano (media3). Cuida da notificação, da tela de bloqueio,
 * dos botões do fone, do foco de áudio, da retomada com o app fechado e do Android Auto.
 */
@UnstableApi
class PlaybackService : MediaLibraryService() {
  private var session: MediaLibrarySession? = null
  private val handler = Handler(Looper.getMainLooper())
  private var consecutiveErrors = 0

  /** Navegação do Android Auto lê o MediaStore: fora da thread principal. */
  private val browseExecutor: ListeningExecutorService = MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor())
  /** Buscas recentes do carro, por "<geração>|<busca>" (a geração muda quando a biblioteca ou os dados mudam). */
  private val searchResults = ConcurrentHashMap<String, List<MediaItem>>()

  private fun searchKey(query: String) = "${BrowseTree.generation}|$query"

  private fun rememberSearch(query: String, results: List<MediaItem>) {
    if (searchResults.size > 20) searchResults.clear()
    searchResults[searchKey(query)] = results
  }

  private val periodicSave = object : Runnable {
    override fun run() {
      saveState()
      handler.postDelayed(this, SAVE_INTERVAL_MS)
    }
  }

  override fun onCreate() {
    super.onCreate()
    // O serviço pode subir sem o app aberto (fone Bluetooth, Android Auto): o crash também conta.
    CrashCatcher.install(this)
    val player = ExoPlayer.Builder(this)
      .setAudioAttributes(
        AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
        /* handleAudioFocus = */ true
      )
      // Pausa quando o fone é desconectado.
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_LOCAL)
      .build()

    // Sessão de áudio fixa para o equalizador poder se ligar antes da primeira música.
    val audioSessionId = Util.generateAudioSessionIdV21(this)
    player.setAudioSessionId(audioSessionId)
    AudioEffects.attach(this, audioSessionId)

    player.addListener(listener)
    // Transição, pular silêncio e ReplayGain valem mesmo com o serviço subindo sem o app (fone, carro).
    PlaybackTuning.load(this)
    PlaybackRuntime.attach(player)

    val builder = MediaLibrarySession.Builder(this, player, LibraryCallback())
      .setBitmapLoader(ArtworkBitmapLoader(this))
    sessionActivity()?.let { builder.setSessionActivity(it) }
    session = builder.build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  /** Fechar o app pelos recentes só encerra o serviço se nada estiver tocando. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    val player = session?.player
    if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
      saveState()
      stopSelf()
    }
  }

  override fun onDestroy() {
    handler.removeCallbacks(periodicSave)
    saveState()
    session?.run {
      (player as? ExoPlayer)?.let { PlaybackRuntime.detach(it) }
      player.removeListener(listener)
      player.release()
      release()
    }
    session = null
    AudioEffects.release()
    browseExecutor.shutdown()
    super.onDestroy()
  }

  private fun sessionActivity(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
    } ?: return null
    return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  // ------------------------------------------------------------ eventos do player

  private val listener = object : Player.Listener {
    override fun onTimelineChanged(timeline: Timeline, reason: Int) {
      if (reason == Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) saveItems()
      // Fila limpa ou nova com o app fora da tela: o balão some ou aparece.
      FloatingBubble.refresh(this@PlaybackService)
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      PlaybackRuntime.onTransition(reason)
      saveState()
      refreshWidget()
    }

    override fun onTracksChanged(tracks: Tracks) {
      PlaybackRuntime.onGainTags(PlaybackTuning.gainTags(tracks))
    }

    override fun onMediaMetadataChanged(mediaMetadata: MediaMetadata) {
      refreshWidget()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      PlaybackRuntime.onPlayingChanged()
      handler.removeCallbacks(periodicSave)
      if (isPlaying) handler.postDelayed(periodicSave, SAVE_INTERVAL_MS) else saveState()
      refreshWidget()
    }

    override fun onPlaybackStateChanged(playbackState: Int) {
      if (playbackState == Player.STATE_READY) consecutiveErrors = 0
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
        PlaybackRuntime.onPausedAtEndOfItem()
      }
    }

    override fun onPlayerError(error: PlaybackException) {
      skipBrokenItem(error)
    }
  }

  /**
   * Arquivo apagado, sem permissão ou num formato que o aparelho não toca: tira da fila e segue
   * para a próxima (tocando só se já estava tocando). Se tudo falhar em sequência, para.
   * Erros que não são do arquivo (saída de áudio, decodificador) só pausam e mantêm a fila.
   */
  private fun skipBrokenItem(error: PlaybackException) {
    val player = PlaybackRuntime.player ?: return
    val count = player.mediaItemCount
    val index = player.currentMediaItemIndex
    val item = player.currentMediaItem
    consecutiveErrors++
    val skip = error.errorCode in ITEM_ERRORS && count > 1 && consecutiveErrors < count && index in 0 until count
    PlaybackRuntime.reportIssue(
      mapOf(
        "type" to if (skip) "skip" else "stop",
        "mediaId" to item?.mediaId,
        "title" to item?.mediaMetadata?.title?.toString(),
        "code" to error.errorCodeName,
        "message" to (error.message ?: error.errorCodeName)
      )
    )
    if (!skip) {
      consecutiveErrors = 0
      player.pause()
      return
    }
    val wasLast = index == count - 1 && player.repeatMode == Player.REPEAT_MODE_OFF
    player.removeMediaItem(index)
    // prepare() respeita o playWhenReady: só volta a tocar se estava tocando.
    player.prepare()
    if (wasLast) {
      player.seekToDefaultPosition(player.mediaItemCount - 1)
      player.pause()
    }
  }

  private fun refreshWidget() {
    val player = PlaybackRuntime.player ?: return
    WidgetUpdater.update(this, WidgetUpdater.stateOf(player))
  }

  // ------------------------------------------------------------ fila salva

  /** Itens da pasta privada ("v:") não vão para a fila salva (widget, retomada pelo fone, próxima abertura). */
  private fun isPrivate(item: MediaItem) = item.mediaId.startsWith("v:")

  private fun saveItems() {
    val player = PlaybackRuntime.player ?: return
    val items = (0 until player.mediaItemCount).map { player.getMediaItemAt(it) }.filterNot(::isPrivate).mapNotNull(::toStored)
    // Tocando só itens privados: mantém a última fila pública salva.
    if (items.isEmpty() && player.mediaItemCount > 0) return
    QueueStore.saveItems(this, items)
    saveState()
  }

  private fun saveState() {
    val player = PlaybackRuntime.player ?: return
    val count = player.mediaItemCount
    if (count == 0) return
    // O índice salvo conta só os itens salvos (sem os da pasta privada).
    val current = player.currentMediaItemIndex
    var kept = 0
    var index = 0
    for (i in 0 until count) {
      if (isPrivate(player.getMediaItemAt(i))) continue
      if (i <= current) index = kept
      kept++
    }
    if (kept == 0) return
    val onPrivate = current in 0 until count && isPrivate(player.getMediaItemAt(current))
    QueueStore.saveState(
      this,
      QueueStore.State(
        index = index,
        positionMs = if (onPrivate) 0 else player.currentPosition,
        shuffle = player.shuffleModeEnabled,
        repeat = player.repeatMode,
        speed = player.playbackParameters.speed
      )
    )
  }

  private fun toStored(item: MediaItem): QueueStore.Item? {
    val uri = item.localConfiguration?.uri?.toString() ?: return null
    val meta = item.mediaMetadata
    return QueueStore.Item(
      id = item.mediaId,
      uri = uri,
      title = meta.title?.toString() ?: item.mediaId,
      artist = meta.artist?.toString(),
      album = meta.albumTitle?.toString(),
      artworkUri = meta.artworkUri?.toString()
    )
  }

  // ------------------------------------------------------------ sessão / Android Auto

  private inner class LibraryCallback : MediaLibrarySession.Callback {
    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>
    ): ListenableFuture<MutableList<MediaItem>> =
      if (mediaItems.all { it.localConfiguration != null }) {
        Futures.immediateFuture(mediaItems)
      } else {
        browseExecutor.submit<MutableList<MediaItem>> { mediaItems.mapNotNull(::resolve).toMutableList() }
      }

    /**
     * O app manda a fila pronta (com URI). Do carro chega só o ID do que foi tocado:
     * aí a fila vira a lista de onde ele veio (álbum, playlist, busca…).
     */
    override fun onSetMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>,
      startIndex: Int,
      startPositionMs: Long
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
      if (mediaItems.all { it.localConfiguration != null }) {
        return Futures.immediateFuture(MediaSession.MediaItemsWithStartPosition(mediaItems, startIndex, startPositionMs))
      }
      return browseExecutor.submit<MediaSession.MediaItemsWithStartPosition> {
        val single = mediaItems.singleOrNull()
        val query = single?.requestMetadata?.searchQuery
        val expanded = when {
          single == null -> null
          single.mediaId.isEmpty() && query != null -> BrowseTree.playFromSearch(this@PlaybackService, query)
          else -> BrowseTree.expand(this@PlaybackService, single.mediaId)
        }
        if (expanded != null) {
          MediaSession.MediaItemsWithStartPosition(expanded.first, expanded.second, C.TIME_UNSET)
        } else {
          val resolved = mediaItems.mapNotNull(::resolve)
          // Lista vazia apagaria a fila atual: falhar deixa tudo como está (lista vazia, busca sem resultado).
          if (resolved.isEmpty()) throw IllegalArgumentException("Nada para tocar")
          MediaSession.MediaItemsWithStartPosition(resolved, startIndex, startPositionMs)
        }
      }
    }

    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: LibraryParams?
    ): ListenableFuture<LibraryResult<MediaItem>> =
      Futures.immediateFuture(LibraryResult.ofItem(BrowseTree.root(), LibraryParams.Builder().setExtras(BrowseTree.rootExtras()).build()))

    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
      browseExecutor.submit<LibraryResult<ImmutableList<MediaItem>>> {
        val all = BrowseTree.children(this@PlaybackService, parentId)
        if (all == null) LibraryResult.ofError(SessionError.ERROR_BAD_VALUE) else LibraryResult.ofItemList(page(all, page, pageSize), params)
      }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String
    ): ListenableFuture<LibraryResult<MediaItem>> =
      browseExecutor.submit<LibraryResult<MediaItem>> {
        BrowseTree.item(this@PlaybackService, mediaId)?.let { LibraryResult.ofItem(it, null) } ?: LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
      }

    override fun onSearch(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      params: LibraryParams?
    ): ListenableFuture<LibraryResult<Void>> {
      browseExecutor.execute {
        val results = runCatching { BrowseTree.searchItems(this@PlaybackService, query) }.getOrDefault(emptyList())
        rememberSearch(query, results)
        handler.post { session.notifySearchResultChanged(browser, query, results.size, params) }
      }
      return Futures.immediateFuture(LibraryResult.ofVoid(params))
    }

    override fun onGetSearchResult(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
      browseExecutor.submit<LibraryResult<ImmutableList<MediaItem>>> {
        val all = searchResults[searchKey(query)] ?: BrowseTree.searchItems(this@PlaybackService, query).also { rememberSearch(query, it) }
        LibraryResult.ofItemList(page(all, page, pageSize), params)
      }

    override fun onPlaybackResumption(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = resumption()

    override fun onPlaybackResumption(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      isForPlayback: Boolean
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = resumption()
  }

  /** Fila salva → itens para o media3 retomar (fone Bluetooth, notificação de retomada). */
  private fun resumption(): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
    val saved = QueueStore.load(this)
      ?: return Futures.immediateFailedFuture(UnsupportedOperationException("Nada para retomar"))
    PlaybackRuntime.player?.let { player ->
      player.shuffleModeEnabled = saved.state.shuffle
      player.repeatMode = saved.state.repeat
      player.setPlaybackSpeed(saved.state.speed)
    }
    return Futures.immediateFuture(
      MediaSession.MediaItemsWithStartPosition(
        ImmutableList.copyOf(saved.items.map(::fromStored)),
        saved.state.index,
        saved.state.positionMs
      )
    )
  }

  /**
   * Itens sem URI (vindos do Android Auto ou de outro app) ganham a URI do MediaStore pelo ID.
   * Chamar fora da thread principal (pode consultar o MediaStore).
   */
  private fun resolve(item: MediaItem): MediaItem? {
    if (item.localConfiguration != null) return item
    val id = BrowseTree.trackId(item.mediaId)
    BrowseTree.track(this, id)?.let { return BrowseTree.playable(it) }
    val rowId = id.toLongOrNull() ?: return null
    return item.buildUpon()
      .setMediaId(id)
      .setUri(ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, rowId))
      .build()
  }

  private fun <T> page(all: List<T>, page: Int, pageSize: Int): List<T> {
    if (pageSize <= 0 || pageSize == Int.MAX_VALUE) return all
    val from = page.coerceAtLeast(0).toLong() * pageSize
    if (from >= all.size) return emptyList()
    return all.subList(from.toInt(), minOf(all.size, (from + pageSize).toInt()))
  }

  companion object {
    private const val SAVE_INTERVAL_MS = 15_000L

    /** Erros do próprio arquivo (sumiu, sem permissão, corrompido, formato não suportado). */
    private val ITEM_ERRORS = setOf(
      PlaybackException.ERROR_CODE_IO_UNSPECIFIED,
      PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
      PlaybackException.ERROR_CODE_IO_NO_PERMISSION,
      PlaybackException.ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE,
      PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
      PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
      PlaybackException.ERROR_CODE_DECODING_FAILED,
      PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES,
      PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED
    )

    fun fromStored(item: QueueStore.Item): MediaItem =
      MediaItem.Builder()
        .setMediaId(item.id)
        .setUri(item.uri)
        .setMediaMetadata(
          MediaMetadata.Builder()
            .setTitle(item.title)
            .setArtist(item.artist)
            .setAlbumTitle(item.album)
            .setIsPlayable(true)
            .setIsBrowsable(false)
            .apply { item.artworkUri?.let { setArtworkUri(Uri.parse(it)) } }
            .build()
        )
        .build()
  }
}
