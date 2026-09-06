package com.gpsflota.tracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Servicio Nativo en Primer Plano (Foreground Service)
 * Garantiza que el GPS continúe reportando las 24 horas del día con la pantalla apagada
 * y sobrevive a la limpieza de memoria de Android.
 */
public class BackgroundTrackingService extends Service {
    private static final String TAG = "GPS_TRACKER_SERVICE";
    private static final String CHANNEL_ID = "GPS_TRACKER_CHANNEL";
    private static final int NOTIFICATION_ID = 9988;

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();

        // 1. Iniciar en Primer Plano con notificación fija requerida por Android OS
        Notification notification = buildForegroundNotification("Rastreo Vehicular Activo", "Transmitiendo posición en segundo plano...");
        startForeground(NOTIFICATION_ID, notification);

        // 2. Adquirir WakeLock para evitar que el CPU se suspenda
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GPSFlota::ServiceWakeLock");
            wakeLock.acquire();
        }

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        setupLocationUpdates();
    }

    private void setupLocationUpdates() {
        // Solicitud de GPS cada 5 segundos de alta precisión
        LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5000)
                .setMinUpdateIntervalMillis(3000)
                .setMinUpdateDistanceMeters(5) // Solo reportar si se desplazó al menos 5 metros
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null) return;
                for (Location location : locationResult.getLocations()) {
                    sendLocationToServer(location);
                }
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.e(TAG, "Permisos de ubicación denegados", e);
        }
    }

    private void sendLocationToServer(Location loc) {
        new Thread(() -> {
            try {
                SharedPreferences prefs = getSharedPreferences("gps_prefs", MODE_PRIVATE);
                String serverUrl = prefs.getString("server_url", "http://192.168.1.100:3000");
                String deviceToken = prefs.getString("device_token", "");

                if (deviceToken.isEmpty()) return;

                URL url = new URL(serverUrl + "/api/mobile/location");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; utf-8");
                conn.setDoOutput(true);
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);

                SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                sdf.setTimeZone(TimeZone.getTimeZone("UTC"));

                JSONObject locationObj = new JSONObject();
                locationObj.put("latitude", loc.getLatitude());
                locationObj.put("longitude", loc.getLongitude());
                locationObj.put("speed", loc.hasSpeed() ? (loc.getSpeed() * 3.6f) : 0);
                locationObj.put("heading", loc.hasBearing() ? loc.getBearing() : 0);
                locationObj.put("accuracy", loc.getAccuracy());
                locationObj.put("recorded_at", sdf.format(new Date(loc.getTime())));

                JSONObject body = new JSONObject();
                body.put("deviceToken", deviceToken);
                body.put("location", locationObj);

                try (OutputStream os = conn.getOutputStream()) {
                    byte[] input = body.toString().getBytes("utf-8");
                    os.write(input, 0, input.length);
                }

                int code = conn.getResponseCode();
                if (code == 200) {
                    Log.d(TAG, "Punto GPS enviado exitosamente");
                }
                conn.disconnect();
            } catch (Exception e) {
                Log.e(TAG, "Error transmitiendo punto GPS: " + e.getMessage());
            }
        }).start();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Servicio de Rastreo GPS",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Monitoreo continuo del vehículo en segundo plano");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildForegroundNotification(String title, String text) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY; // START_STICKY hace que Android reinicie el servicio si el sistema lo cierra
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
