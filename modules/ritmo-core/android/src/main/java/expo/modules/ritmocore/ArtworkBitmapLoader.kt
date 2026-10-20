package expo.modules.ritmocore

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.ListeningExecutorService
import com.google.common.util.concurrent.MoreExecutors
import java.util.concurrent.Executors

/**
 * Carrega a capa para a notificação, a tela de bloqueio e o Android Auto.
 * URIs `ritmo-art://album/<albumId>?track=<uri>` passam pelo mesmo cache de capas do app
 * (miniatura do álbum ou imagem embutida no MP3); o resto vai para o carregador padrão.
 */
@UnstableApi
class ArtworkBitmapLoader(private val context: Context) : BitmapLoader {
  private val fallback = DataSourceBitmapLoader(context)

  override fun supportsMimeType(mimeType: String): Boolean = fallback.supportsMimeType(mimeType)

  override fun decodeBitmap(data: ByteArray): ListenableFuture<Bitmap> = fallback.decodeBitmap(data)

  override fun loadBitmap(uri: Uri): ListenableFuture<Bitmap> {
    if (uri.scheme != SCHEME) return fallback.loadBitmap(uri)
    return executor.submit<Bitmap> {
      val albumId = uri.lastPathSegment ?: throw IllegalArgumentException("Capa sem álbum: $uri")
      val track = uri.getQueryParameter("track")
      val file = MediaLibrary.artwork(context, albumId, track, SIZE) ?: throw IllegalStateException("Álbum sem capa")
      BitmapFactory.decodeFile(Uri.parse(file).path) ?: throw IllegalStateException("Capa ilegível")
    }
  }

  companion object {
    const val SCHEME = "ritmo-art"
    private const val SIZE = 512

    /** Uma thread só para o processo todo (o serviço pode ser recriado várias vezes). */
    private val executor: ListeningExecutorService = MoreExecutors.listeningDecorator(Executors.newSingleThreadExecutor())

    /** Monta a URI de capa a partir do álbum e da faixa (usado ao restaurar a fila salva). */
    fun uriFor(albumId: String, trackUri: String): String =
      Uri.Builder().scheme(SCHEME).authority("album").appendPath(albumId).appendQueryParameter("track", trackUri).build().toString()
  }
}
