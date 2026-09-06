# 🛰️ Sistema de Rastreo Vehicular GPS con Gestión Centralizada y Móviles en Segundo Plano

Sistema completo para el seguimiento en tiempo real de flotas vehiculares y visualización del historial diario de recorridos, diseñado con un panel central de administración web y una aplicación cliente para dispositivos móviles con funcionamiento continuo en segundo plano.

---

## 🌟 Características Principales

### 1. Panel Web Administrador (PC / Oficina)
- **Gestión Centralizada de la Flota**: Alta, baja y edición en tiempo real de vehículos (nombre, patente, tipo de unidad, chofer asignado, color identificador).
- **Sincronización en Vivo**: Cualquier cambio de nombre o datos que realices en la web se actualiza instantáneamente en el teléfono móvil sin recargar.
- **Emparejamiento Rápido por Código y QR**: Cada vehículo genera un código único (ej: `TRK-1001`) y un código QR para escanear con la cámara del celular.
- **Mapa en Vivo Multi-Vehículo**: Visualización en tiempo real de toda la flota sobre OpenStreetMap (sin costes ni cuotas de Google Maps).
- **Historial Diario y Reproductor de Rutas**:
  - Selector de fecha en calendario para ver el recorrido de cualquier día.
  - Trazado de polilíneas con código de colores según la velocidad.
  - Banderas automáticas de inicio (verde) y llegada (rojo).
  - Detección inteligente de paradas (duración y horario exacto).
  - Reproductor animado (*Play, Pausa, x1, x2, x5, x10*) con barra de tiempo interactiva (*Scrubber*).
  - Métricas de la jornada: Distancia total (km), velocidad máxima y promedio, tiempo en marcha y tiempo detenido.
- **Control Remoto de Dispositivos**: Posibilidad de desvincular un teléfono celular de un vehículo a distancia.
- **PIN Maestro de Seguridad**: Configuración de la clave maestra que impide a los choferes detener el rastreo en el celular.

### 2. Dispositivo Móvil (en el Vehículo)
- **Instalación y Emparejamiento en 1 Paso**: Se ingresa el código o se escanea el QR generado en la web.
- **Rastreo Permanente en Segundo Plano**:
  - Diseñado para seguir transmitiendo coordenadas con la pantalla apagada o mientras el chofer usa otras aplicaciones (como Waze o WhatsApp).
  - Prevención de suspensión mediante *Screen WakeLock* y *Audio KeepAlive*.
  - Inicio automático al encender el celular (*Boot Completed Receiver* en Android).
- **Búfer Offline de Contingencia**: Si el vehículo ingresa a una zona sin señal celular (túnel, ruta desértica), almacena los puntos en memoria local y los sincroniza en ráfaga automáticamente al recuperar cobertura 4G/Wi-Fi.
- **Pestaña "Mi Recorrido del Día" en el Celular**: El chofer puede consultar en su propia pantalla el mapa con el recorrido que realizó en el día, los kilómetros acumulados y las paradas.
- **Protección contra Desactivación**: No existe un botón de "Detener" libre. Para quitar la configuración o desvincular se exige obligatoriamente el **PIN de Administrador**. Solo se puede dejar de rastrear introduciendo el PIN o desinstalando la aplicación.

### 3. Simulador GPS Integrado
- Permite probar el sistema de inmediato desde tu PC sin necesidad de salir a conducir un automóvil:
  - **Simulación en Tiempo Real**: Mueve un vehículo paso a paso por las calles de una ciudad cada 3 segundos.
  - **Generador de Día Completo**: Inyecta instantáneamente un recorrido realista de 40 puntos y 3 paradas para validar el historial y el reproductor.

---

## 🚀 Puesta en Marcha

### Requisitos Previos:
- Node.js (versión 18 o superior).

### Paso 1: Iniciar el Servidor
Abre una terminal en esta carpeta y ejecuta:
```bash
npm start
```

El servidor responderá mostrando las URLs de acceso:
```
====================================================
🚀 SERVIDOR DE RASTREO VEHICULAR GPS INICIADO
🌐 Panel Central Web:    http://localhost:3000
📱 App Móvil (Vehículo): http://localhost:3000/mobile
----------------------------------------------------
📶 Para conectar tu teléfono móvil en la misma red Wi-Fi:
   👉 http://192.168.1.XX:3000/mobile
====================================================
```

### Paso 2: Abrir el Panel Web
En tu navegador ingresa a:
👉 `http://localhost:3000`

---

## 📲 Cómo Conectar el Dispositivo Móvil del Vehículo

### Opción A: En la misma red Wi-Fi o datos móviles
1. Asegúrate de que el teléfono esté conectado a la misma red Wi-Fi de la computadora (o utiliza una herramienta como `ngrok` o `localtunnel` si el vehículo está en la calle con datos 4G: `npx localtunnel --port 3000`).
2. Abre el navegador de tu celular e ingresa la dirección IP que te indicó la terminal, por ejemplo:
   `http://192.168.1.XX:3000/mobile`
3. En la pantalla del celular ingresa el código de activación del vehículo (ej: `TRK-1001`) o escanea el QR desde el Panel Web.
4. Toca **"Vincular y Activar Rastreo Permanente"**.
5. ¡Listo! El celular comenzará a transmitir la posición y verás el movimiento reflejado en tiempo real en la pantalla de la oficina.

### Opción B: Instalar como PWA (Acceso Directo en Pantalla de Inicio)
1. En Google Chrome para Android o Safari en iPhone, toca los tres puntos (menú del navegador) o el botón de compartir.
2. Selecciona **"Agregar a la pantalla de inicio"** / **"Instalar aplicación"**.
3. Se creará un ícono nativo en el teléfono que se abre a pantalla completa.

### Opción C: Compilar APK Nativo para Android
En la carpeta `mobile-android/` se incluyen los archivos nativos necesarios:
- `AndroidManifest.xml`: Configurado con `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`, `RECEIVE_BOOT_COMPLETED`, y exención de optimización de batería.
- `BackgroundTrackingService.java`: Servicio Foreground con notificación fija que garantiza que Android nunca detenga el proceso.
- `BootReceiver.java`: Reactiva el rastreo apenas el teléfono se reinicia o se enciende.

---

## 🔒 Seguridad y PIN Maestro

- **PIN por Defecto**: `1234`
- Para cambiarlo: Dirígete a la pestaña **"Gestión de Vehículos"** en el Panel Web y presiona el botón **"🔑 PIN Maestro de Seguridad"**.
- Cualquier intento de desvincular o apagar el rastreador en el celular del chofer requerirá ingresar este PIN. Si se ingresa una clave incorrecta, el rastreo continúa inalterable.
