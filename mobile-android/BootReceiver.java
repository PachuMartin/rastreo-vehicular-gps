package com.gpsflota.tracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * Receptor de Inicio: Se dispara automáticamente cuando el teléfono móvil
 * termina de encender o reiniciar, reactivando el rastreo de inmediato.
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "GPS_BOOT_RECEIVER";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(intent.getAction())) {
            
            Log.d(TAG, "Teléfono reiniciado. Reactivando servicio de rastreo en segundo plano...");

            Intent serviceIntent = new Intent(context, BackgroundTrackingService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        }
    }
}
