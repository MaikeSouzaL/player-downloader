package expo.modules.ritmocore

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.view.KeyEvent
import android.widget.RemoteViews
import androidx.media3.common.Player
import androidx.media3.session.MediaButtonReceiver
import java.util.concurrent.Executors

/** Widget da tela inicial: capa, título, artista e anterior / tocar / próxima. */
class RitmoWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    val pending = goAsync()
    WidgetUpdater.refresh(context) { pending.finish() }
  }

  override fun onReceive(context: Context, intent: Intent) {
    // O MediaButtonReceiver do media3 só aceita "tocar" quando o serviço está parado, então
    // anterior/próxima vêm direto para cá e falam com o player do processo (se estiver rodando).
    when (intent.action) {
      WidgetUpdater.ACTION_PREVIOUS -> PlaybackRuntime.player?.takeIf { it.mediaItemCount > 0 }?.seekToPrevious()
      WidgetUpdater.ACTION_NEXT -> PlaybackRuntime.player?.takeIf { it.hasNextMediaItem() }?.seekToNextMediaItem()
      else -> super.onReceive(context, intent)
    }
  }
}

object WidgetUpdater {
  data class State(val title: String, val artist: String?, val isPlaying: Boolean, val artworkUri: String?)

  const val ACTION_PREVIOUS = "expo.modules.ritmocore.WIDGET_PREVIOUS"
  const val ACTION_NEXT = "expo.modules.ritmocore.WIDGET_NEXT"

  private val executor = Executors.newSingleThreadExecutor()
  @Volatile private var lastArtworkUri: String? = null
  @Volatile private var lastArtwork: android.graphics.Bitmap? = null

  /** Chamado pelo serviço quando a música ou o estado muda. A capa é carregada fora da thread principal. */
  fun update(context: Context, state: State?, done: (() -> Unit)? = null) {
    val app = context.applicationContext
    executor.execute {
      try {
        render(app, state)
      } finally {
        done?.invoke()
      }
    }
  }

  /** Estado atual do player (chamar na thread principal). */
  fun stateOf(player: Player): State? =
    player.currentMediaItem?.let {
      // Pasta privada: o widget não mostra o nome nem a capa.
      if (it.mediaId.startsWith("v:")) return@let State(title = "Player Downloader", artist = null, isPlaying = player.isPlaying, artworkUri = null)
      State(
        title = it.mediaMetadata.title?.toString() ?: it.mediaId,
        artist = it.mediaMetadata.artist?.toString(),
        isPlaying = player.isPlaying,
        artworkUri = it.mediaMetadata.artworkUri?.toString()
      )
    }

  /** Com o serviço rodando usa o player; senão mostra a última música salva, pausada. */
  fun refresh(context: Context, done: (() -> Unit)? = null) {
    val player = PlaybackRuntime.player
    if (player != null) {
      update(context, stateOf(player), done)
      return
    }
    val saved = runCatching { QueueStore.load(context) }.getOrNull()
    val item = saved?.items?.getOrNull(saved.state.index)
    update(context, item?.let { State(it.title, it.artist, false, it.artworkUri) }, done)
  }

  private fun render(context: Context, state: State?) {
    val manager = AppWidgetManager.getInstance(context)
    val ids = manager.getAppWidgetIds(ComponentName(context, RitmoWidget::class.java))
    if (ids.isEmpty()) return

    val views = RemoteViews(context.packageName, R.layout.ritmo_widget)
    views.setTextViewText(R.id.widget_title, state?.title ?: context.getString(R.string.ritmo_widget_empty))
    views.setTextViewText(R.id.widget_artist, state?.artist ?: "")
    views.setImageViewResource(
      R.id.widget_play,
      if (state?.isPlaying == true) R.drawable.ritmo_widget_pause else R.drawable.ritmo_widget_play
    )
    val cover = state?.artworkUri?.let { loadArtwork(context, it) }
    if (cover != null) views.setImageViewBitmap(R.id.widget_cover, cover)
    else views.setImageViewResource(R.id.widget_cover, R.drawable.ritmo_widget_cover)

    views.setOnClickPendingIntent(R.id.widget_prev, widgetAction(context, ACTION_PREVIOUS, 1))
    views.setOnClickPendingIntent(R.id.widget_play, mediaButton(context, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
    views.setOnClickPendingIntent(R.id.widget_next, widgetAction(context, ACTION_NEXT, 2))
    openApp(context)?.let {
      views.setOnClickPendingIntent(R.id.widget_cover, it)
      views.setOnClickPendingIntent(R.id.widget_texts, it)
    }
    manager.updateAppWidget(ids, views)
  }

  /** Mesma capa da notificação (URI ritmo-art:// resolvida pelo cache de capas). */
  private fun loadArtwork(context: Context, artworkUri: String): android.graphics.Bitmap? {
    if (artworkUri == lastArtworkUri && lastArtwork != null) return lastArtwork
    val bitmap = runCatching {
      val uri = Uri.parse(artworkUri)
      val file = if (uri.scheme == ArtworkBitmapLoader.SCHEME) {
        MediaLibrary.artwork(context, uri.lastPathSegment ?: return null, uri.getQueryParameter("track"), 256)
      } else {
        artworkUri
      } ?: return null
      BitmapFactory.decodeFile(Uri.parse(file).path)
    }.getOrNull()
    lastArtworkUri = artworkUri
    lastArtwork = bitmap
    return bitmap
  }

  /** Tocar/pausar manda a tecla de mídia para o media3, que acorda o serviço do jeito certo. */
  private fun mediaButton(context: Context, keyCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_MEDIA_BUTTON)
      .setComponent(ComponentName(context, MediaButtonReceiver::class.java))
      .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
    return PendingIntent.getBroadcast(context, keyCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun widgetAction(context: Context, action: String, requestCode: Int): PendingIntent {
    val intent = Intent(action).setComponent(ComponentName(context, RitmoWidget::class.java))
    return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun openApp(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(context, 1, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }
}
