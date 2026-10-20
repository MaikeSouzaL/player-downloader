package expo.modules.ritmocore

import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.RingtoneManager
import android.net.Uri
import android.provider.MediaStore
import android.provider.Settings

/** Toque do celular e saída de áudio. */
object DeviceActions {

  fun canWriteSettings(context: Context): Boolean = Settings.System.canWrite(context)

  /** Tela do Android "Modificar configurações do sistema" para este app. */
  fun openWriteSettings(context: Context) {
    val intent = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse("package:${context.packageName}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  /** type: "call" (toque de chamada), "notification" ou "alarm". */
  fun setRingtone(context: Context, trackId: String, type: String): Boolean {
    val id = trackId.toLongOrNull() ?: return false
    if (!canWriteSettings(context)) return false
    val uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id)
    val kind = when (type) {
      "notification" -> RingtoneManager.TYPE_NOTIFICATION
      "alarm" -> RingtoneManager.TYPE_ALARM
      else -> RingtoneManager.TYPE_RINGTONE
    }
    RingtoneManager.setActualDefaultRingtoneUri(context, kind, uri)
    return true
  }

  /** "bluetooth", "wired" ou "speaker" — o Lark mostra isso no equalizador. */
  fun outputDevice(context: Context): Map<String, Any?> {
    val am = context.getSystemService(AudioManager::class.java)
    val outputs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    val bluetooth = outputs.firstOrNull { it.type in BLUETOOTH }
    val wired = outputs.firstOrNull { it.type in WIRED }
    return when {
      bluetooth != null -> mapOf("kind" to "bluetooth", "name" to bluetooth.productName?.toString())
      wired != null -> mapOf("kind" to "wired", "name" to wired.productName?.toString())
      else -> mapOf("kind" to "speaker", "name" to null)
    }
  }

  private val BLUETOOTH = setOf(
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    26, // TYPE_BLE_HEADSET (API 31)
    27, // TYPE_BLE_SPEAKER (API 31)
    30 // TYPE_BLE_BROADCAST (API 33)
  )

  private val WIRED = setOf(
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_USB_DEVICE
  )
}
