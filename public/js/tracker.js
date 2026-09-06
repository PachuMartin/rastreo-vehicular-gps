// Módulo Móvil: Rastreo Continuo en Segundo Plano, WakeLock, Búfer Offline, Bloqueo por PIN y Diagnóstico de Errores
const MobileTracker = {
  isTracking: false,
  deviceToken: null,
  vehicleInfo: null,
  watchId: null,
  wakeLock: null,
  audioContext: null,
  offlineQueue: [],
  pointsSentCount: 0,
  lastPosition: null,
  ws: null,
  localMap: null,
  localRouteLayer: null,
  lastPairingError: null,
  qrScanner: null,

  async init() {
    this.initDeviceToken();
    this.initServerUrlInput();
    this.bindEvents();
    this.checkPairStatus();
    this.initNetworkListener();
    this.initWebSocket();
  },

  // Obtener la URL del servidor configurada
  getServerUrl() {
    const input = document.getElementById('server-url-input');
    if (input && input.value && input.value.trim()) {
      return input.value.trim().replace(/\/+$/, '');
    }
    const saved = localStorage.getItem('gps_server_url');
    if (saved && saved.trim()) {
      return saved.trim().replace(/\/+$/, '');
    }
    // Si corre en web y no en localhost dentro de un emulador/APK
    if (window.location.origin && !window.location.origin.includes('localhost') && window.location.protocol.startsWith('http')) {
      return window.location.origin;
    }
    return '';
  },

  initServerUrlInput() {
    const input = document.getElementById('server-url-input');
    if (!input) return;

    const saved = localStorage.getItem('gps_server_url');
    const badge = document.getElementById('server-detected-badge');

    if (saved) {
      input.value = saved;
      if (badge) badge.innerText = 'Guardado';
    } else if (window.location.origin && !window.location.origin.includes('localhost') && window.location.protocol.startsWith('http')) {
      input.value = window.location.origin;
      if (badge) badge.innerText = 'Detectado';
    } else {
      input.value = '';
      if (badge) badge.innerText = 'Requerido en APK';
    }

    input.addEventListener('change', () => {
      const val = input.value.trim().replace(/\/+$/, '');
      if (val) {
        localStorage.setItem('gps_server_url', val);
        if (badge) badge.innerText = 'Guardado';
      }
    });
  },

  // Generar o recuperar token único del dispositivo
  initDeviceToken() {
    let token = localStorage.getItem('gps_device_token');
    if (!token) {
      token = 'DEV-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Date.now();
      localStorage.setItem('gps_device_token', token);
    }
    this.deviceToken = token;
  },

  bindEvents() {
    // Formulario de emparejamiento
    const pairForm = document.getElementById('mobile-pair-form');
    if (pairForm) {
      pairForm.addEventListener('submit', (e) => this.handlePairSubmit(e));
    }

    // Escáner de Código QR con Cámara
    const btnOpenQr = document.getElementById('btn-open-qr-scanner');
    if (btnOpenQr) {
      btnOpenQr.addEventListener('click', () => this.openQrScanner());
    }

    const btnCloseQr = document.getElementById('btn-close-qr-scanner');
    if (btnCloseQr) {
      btnCloseQr.addEventListener('click', () => this.stopQrScanner());
    }

    const btnCancelQr = document.getElementById('btn-cancel-qr-scanner');
    if (btnCancelQr) {
      btnCancelQr.addEventListener('click', () => this.stopQrScanner());
    }

    const qrModal = document.getElementById('qr-scanner-modal');
    if (qrModal) {
      qrModal.addEventListener('click', (e) => {
        if (e.target === qrModal) this.stopQrScanner();
      });
    }

    // Botón de descargar informe de error
    const btnDownloadError = document.getElementById('btn-download-error-log');
    if (btnDownloadError) {
      btnDownloadError.addEventListener('click', () => this.downloadErrorLog());
    }

    // Botón de copiar diagnóstico
    const btnCopyError = document.getElementById('btn-copy-error-log');
    if (btnCopyError) {
      btnCopyError.addEventListener('click', () => this.copyErrorLog());
    }

    // Botón de desvincular (protegido con PIN)
    const btnUnlink = document.getElementById('btn-mobile-unlink');
    if (btnUnlink) {
      btnUnlink.addEventListener('click', () => this.openPinModal());
    }

    // Formulario de verificación de PIN
    const pinForm = document.getElementById('form-verify-pin');
    if (pinForm) {
      pinForm.addEventListener('submit', (e) => this.handlePinVerification(e));
    }

    // Pestañas móviles: Rastreador vs Mi Recorrido
    const tabTracker = document.getElementById('tab-btn-tracker');
    const tabHistory = document.getElementById('tab-btn-my-route');
    if (tabTracker && tabHistory) {
      tabTracker.addEventListener('click', () => this.switchMobileTab('tracker'));
      tabHistory.addEventListener('click', () => this.switchMobileTab('my-route'));
    }

    // Selector de fecha en el móvil
    const mobileDateInput = document.getElementById('mobile-date-input');
    if (mobileDateInput) {
      mobileDateInput.value = new Date().toISOString().slice(0, 10);
      mobileDateInput.addEventListener('change', () => this.loadMobileDailyRoute());
    }

    // Auto-completar código si viene por parámetro URL (?code=TRK-1001)
    const urlParams = new URLSearchParams(window.location.search);
    const codeParam = urlParams.get('code');
    if (codeParam) {
      const codeInput = document.getElementById('pair-code-input');
      if (codeInput) codeInput.value = codeParam;
    }
  },

  // Verificar si el teléfono ya está vinculado a un vehículo
  checkPairStatus() {
    const saved = localStorage.getItem('gps_vehicle_info');
    if (saved) {
      try {
        this.vehicleInfo = JSON.parse(saved);
        this.showActiveTrackingScreen();
        this.startBackgroundTracking();
        return;
      } catch (e) {
        console.error('Error parseando datos de vehículo local:', e);
      }
    }
    this.showPairingScreen();
  },

  showPairingScreen() {
    document.getElementById('mobile-pairing-section').classList.remove('hidden');
    document.getElementById('mobile-active-section').classList.add('hidden');
  },

  showActiveTrackingScreen() {
    document.getElementById('mobile-pairing-section').classList.add('hidden');
    document.getElementById('mobile-active-section').classList.remove('hidden');

    if (this.vehicleInfo) {
      document.getElementById('m-vehicle-name').innerText = this.vehicleInfo.name;
      document.getElementById('m-vehicle-plate').innerText = this.vehicleInfo.plate;
      document.getElementById('m-vehicle-driver').innerText = this.vehicleInfo.driver_name || 'Sin chofer asignado';
      document.getElementById('m-vehicle-code').innerText = this.vehicleInfo.code;
    }
  },

  // ==============================================================
  // ESCÁNER DE CÓDIGO QR CON CÁMARA (HTML5-QRCODE)
  // ==============================================================
  async openQrScanner() {
    const modal = document.getElementById('qr-scanner-modal');
    const loading = document.getElementById('qr-loading-indicator');
    const status = document.getElementById('qr-scanner-status');

    if (modal) modal.classList.add('active');
    if (loading) loading.classList.remove('hidden');
    if (status) {
      status.innerText = 'Iniciando cámara...';
      status.className = 'text-xs text-slate-400 font-medium';
    }

    try {
      if (typeof Html5Qrcode === 'undefined') {
        throw new Error('La librería del escáner no está lista. Revisa tu conexión.');
      }

      // Detener cualquier instancia previa activa
      if (this.qrScanner) {
        await this.stopQrScanner();
      }

      this.qrScanner = new Html5Qrcode('qr-reader');

      const config = {
        fps: 10,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const edge = Math.min(viewfinderWidth, viewfinderHeight) * 0.75;
          return { width: Math.round(edge), height: Math.round(edge) };
        },
        aspectRatio: 1.0
      };

      // Intentar primero con la cámara trasera ('environment')
      try {
        await this.qrScanner.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => this.onQrCodeScanned(decodedText),
          () => {} // Ignorar cuadros sin código
        );
      } catch (camErr) {
        console.warn('Fallo cámara trasera preferida, probando cámaras disponibles:', camErr);
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          const selectedCam = cameras[cameras.length - 1].id;
          await this.qrScanner.start(
            selectedCam,
            config,
            (decodedText) => this.onQrCodeScanned(decodedText),
            () => {}
          );
        } else {
          throw camErr;
        }
      }

      if (loading) loading.classList.add('hidden');
      if (status) {
        status.innerText = '📷 Apunta la cámara al código QR';
        status.className = 'text-xs text-emerald-400 font-bold';
      }
    } catch (err) {
      console.error('Error al inicializar cámara:', err);
      if (loading) loading.classList.add('hidden');

      let userMsg = 'No se pudo acceder a la cámara.';
      if (err.name === 'NotAllowedError' || (err.message && err.message.toLowerCase().includes('permission'))) {
        userMsg = 'Permiso denegado: Por favor habilita el permiso de Cámara para esta aplicación en los Ajustes del dispositivo.';
      } else if (err.name === 'NotFoundError' || (err.message && err.message.toLowerCase().includes('no camera'))) {
        userMsg = 'No se detectó cámara disponible en el dispositivo.';
      } else if (err.message) {
        userMsg = err.message;
      }

      if (status) {
        status.innerText = `⚠️ ${userMsg}`;
        status.className = 'text-xs text-red-400 font-semibold';
      }
      showToast('No se pudo abrir la cámara', 'danger');
    }
  },

  async stopQrScanner() {
    const modal = document.getElementById('qr-scanner-modal');
    if (modal) modal.classList.remove('active');

    if (this.qrScanner) {
      try {
        if (this.qrScanner.isScanning) {
          await this.qrScanner.stop();
        }
        this.qrScanner.clear();
      } catch (e) {
        console.warn('Error cerrando escáner:', e);
      }
      this.qrScanner = null;
    }
  },

  async onQrCodeScanned(decodedText) {
    if (!decodedText) return;
    console.log('Código QR detectado:', decodedText);

    // Detener la cámara de inmediato
    await this.stopQrScanner();

    const raw = decodedText.trim();
    let serverFound = null;
    let codeFound = null;

    // Caso 1: URL completa del panel web (ej. https://mi-app.onrender.com/mobile?code=TRK-1001)
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      try {
        const url = new URL(raw);
        serverFound = url.origin;
        if (url.searchParams.has('code')) {
          codeFound = url.searchParams.get('code');
        }
      } catch (e) {
        console.warn('Error analizando URL escaneada:', e);
      }
    }

    // Caso 2: Si el QR es solo el código o texto con formato TRK-XXXX
    if (!codeFound) {
      const match = raw.match(/(TRK-[A-Za-z0-9_-]+)/i);
      if (match) {
        codeFound = match[1].toUpperCase();
      } else if (!raw.includes('/') && !raw.includes(' ') && raw.length <= 25) {
        codeFound = raw.toUpperCase();
      }
    }

    // Si se extrajo la dirección del servidor, guardarla y aplicarla
    if (serverFound) {
      const serverInput = document.getElementById('server-url-input');
      const badge = document.getElementById('server-detected-badge');
      if (serverInput) {
        serverInput.value = serverFound;
        localStorage.setItem('gps_server_url', serverFound);
        if (badge) badge.innerText = 'Detectado por QR';
      }
    }

    // Si se extrajo el código de activación, aplicarlo y disparar vinculación
    const codeInput = document.getElementById('pair-code-input');
    if (codeFound && codeInput) {
      codeInput.value = codeFound;
      showToast(`¡Código ${codeFound} detectado! Conectando...`, 'success');

      setTimeout(() => {
        const pairForm = document.getElementById('mobile-pair-form');
        if (pairForm && typeof pairForm.requestSubmit === 'function') {
          pairForm.requestSubmit();
        } else {
          this.handlePairSubmit();
        }
      }, 350);
    } else {
      if (codeInput) codeInput.value = raw;
      showToast(`Escaneado: ${raw}`, 'info');
    }
  },

  // Emparejar teléfono con el código generado desde la web
  async handlePairSubmit(e) {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    const codeInput = document.getElementById('pair-code-input');
    const code = codeInput ? codeInput.value.trim().toUpperCase() : '';
    const errorBox = document.getElementById('pairing-error-box');
    const btnSubmit = document.getElementById('btn-pair-submit');

    if (errorBox) errorBox.classList.add('hidden');

    if (!code) {
      showToast('Por favor ingresa el código de activación', 'warning');
      return;
    }

    // Obtener y normalizar la URL del servidor
    let serverUrl = this.getServerUrl();
    if (!serverUrl) {
      // Si está vacía y estamos en localhost / app instalada
      if (window.location.protocol.startsWith('http') && !window.location.origin.includes('localhost')) {
        serverUrl = window.location.origin;
      } else {
        serverUrl = 'https://' + window.location.host;
      }
    }

    // Asegurar protocolo http/https
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
      serverUrl = 'https://' + serverUrl;
    }
    serverUrl = serverUrl.replace(/\/+$/, '');

    // Guardar para futuros envíos
    localStorage.setItem('gps_server_url', serverUrl);
    const serverInput = document.getElementById('server-url-input');
    if (serverInput) serverInput.value = serverUrl;

    const deviceInfo = `${navigator.userAgent} - ${navigator.platform}`;
    const endpoint = `${serverUrl}/api/mobile/pair`;

    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerText = '⏳ Conectando con servidor...';
    }

    try {
      showToast('Vinculando con el servidor...', 'info');

      // Controlador de timeout de 15 segundos
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      let res, responseText, data;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            deviceToken: this.deviceToken,
            deviceInfo
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        responseText = await res.text();
      } catch (fetchErr) {
        clearTimeout(timeoutId);
        throw fetchErr;
      }

      try {
        data = JSON.parse(responseText);
      } catch (parseErr) {
        data = { error: responseText || 'Respuesta no válida del servidor' };
      }

      if (!res.ok) {
        const customError = new Error(data.error || `HTTP ${res.status}: Fallo de respuesta del servidor`);
        customError.httpStatus = res.status;
        customError.responseText = responseText;
        throw customError;
      }

      this.vehicleInfo = data.vehicle;
      localStorage.setItem('gps_vehicle_info', JSON.stringify(this.vehicleInfo));

      showToast(`¡Vehículo vinculado: ${this.vehicleInfo.name}!`, 'success');
      this.showActiveTrackingScreen();
      this.startBackgroundTracking();

    } catch (err) {
      console.error('Fallo en vinculación:', err);

      // Guardar detalle para generar el archivo de texto descargable
      this.lastPairingError = {
        timestamp: new Date(),
        code,
        serverUrl,
        endpoint,
        message: err.name === 'AbortError' ? 'Tiempo de espera agotado (Timeout 15s). El servidor no respondió.' : (err.message || 'Error de conexión desconocido'),
        httpStatus: err.httpStatus || (err.name === 'AbortError' ? 408 : 0),
        responseText: err.responseText || '',
        stack: err.stack || '',
        deviceInfo
      };

      this.displayPairingError(this.lastPairingError);
      showToast('Error de vinculación. Puedes descargar el informe de error.', 'danger');

    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerText = '🚀 Vincular y Activar Rastreo Permanente';
      }
    }
  },

  // Mostrar el error en la interfaz móvil
  displayPairingError(errInfo) {
    const errorBox = document.getElementById('pairing-error-box');
    const msgElem = document.getElementById('pairing-error-msg');
    const srvElem = document.getElementById('err-diag-server');
    const codeElem = document.getElementById('err-diag-code');
    const netElem = document.getElementById('err-diag-net');

    if (!errorBox) return;

    if (msgElem) {
      let friendly = errInfo.message;
      if (errInfo.message.includes('Failed to fetch') || errInfo.httpStatus === 0) {
        friendly = `No se pudo conectar a "${errInfo.serverUrl}". Revisa que la URL del servidor sea accesible desde internet (ej. en Render) y que tengas conexión de datos o Wi-Fi.`;
      }
      msgElem.innerText = friendly;
    }

    if (srvElem) srvElem.innerText = errInfo.serverUrl || 'No definida';
    if (codeElem) codeElem.innerText = errInfo.code || '--';
    if (netElem) netElem.innerText = navigator.onLine ? 'Conectado a Internet' : 'Sin conexión de red (Offline)';

    errorBox.classList.remove('hidden');
    errorBox.scrollIntoView({ behavior: 'smooth' });
  },

  // Generar texto plano del informe de diagnóstico
  getReportText() {
    const err = this.lastPairingError || {
      timestamp: new Date(),
      code: 'N/A',
      serverUrl: this.getServerUrl(),
      endpoint: `${this.getServerUrl()}/api/mobile/pair`,
      message: 'Diagnóstico generado manualmente',
      httpStatus: 0,
      responseText: '',
      stack: ''
    };

    const now = new Date();
    const isCapacitor = Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

    return [
      '====================================================================',
      '        INFORME DE ERROR DE VINCULACIÓN - GPS VEHICULAR PRO         ',
      '====================================================================',
      `Fecha y Hora Local : ${now.toLocaleString()}`,
      `Fecha y Hora UTC   : ${now.toISOString()}`,
      `Código de Unidad   : ${err.code}`,
      `Servidor Destino   : ${err.serverUrl}`,
      `Endpoint Intentado : ${err.endpoint}`,
      '',
      '--------------------------------------------------------------------',
      '1. DETALLE DEL ERROR',
      '--------------------------------------------------------------------',
      `Mensaje de Error   : ${err.message}`,
      `Código HTTP Status : ${err.httpStatus !== undefined ? err.httpStatus : '0 (Sin respuesta del servidor / Error de Red)'}`,
      `Respuesta Servidor : ${err.responseText || '(Sin datos devueltos)'}`,
      '',
      'Pila de Ejecución (Stack Trace):',
      err.stack || '(No disponible)',
      '',
      '--------------------------------------------------------------------',
      '2. DIAGNÓSTICO DEL DISPOSITIVO Y ENTORNO',
      '--------------------------------------------------------------------',
      `Internet Detectado : ${navigator.onLine ? 'SÍ (En línea)' : 'NO (Sin internet)'}`,
      `App Nativa (APK)   : ${isCapacitor ? 'SÍ (Capacitor / Android Nativo)' : 'NO (Navegador Web / PWA)'}`,
      `Origen Web         : ${window.location.origin || 'null'}`,
      `URL de la Pantalla : ${window.location.href}`,
      `User-Agent Móvil   : ${navigator.userAgent}`,
      `Plataforma         : ${navigator.platform}`,
      `Soporte GPS        : ${'geolocation' in navigator ? 'SÍ (Disponible)' : 'NO (No soportado)'}`,
      `Almacenamiento     : ${typeof localStorage !== 'undefined' ? 'SÍ (Disponible)' : 'NO'}`,
      `Token Dispositivo  : ${this.deviceToken}`,
      '',
      '--------------------------------------------------------------------',
      '3. GUÍA RÁPIDA DE RESOLUCIÓN',
      '--------------------------------------------------------------------',
      'A) Si el error dice "Failed to fetch" o "Status 0":',
      '   - El teléfono no logra llegar a la dirección del servidor.',
      '   - Si estás usando el instalador APK en el celular, la casilla "Servidor Web"',
      '     NO debe decir "localhost". Debe tener la URL pública de tu servidor',
      '     (ejemplo: https://gps-flota-xxxx.onrender.com).',
      '',
      'B) Si el error dice "Código de activación inválido o vehículo no encontrado":',
      '   - El código ingresado no existe en el Panel Web Administrador.',
      '   - Ingresa al panel en la PC y verifica el código asignado (ej: TRK-1001).',
      '',
      'C) Si el error es HTTP 404 o 500:',
      '   - El servicio en Render puede estar iniciándose. Espera 1 minuto y reintenta.',
      '===================================================================='
    ].join('\r\n');
  },

  // Descargar el archivo .txt directamente en el dispositivo móvil
  downloadErrorLog() {
    const reportText = this.getReportText();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestampStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `error_vinculacion_gps_${timestampStr}.txt`;

    try {
      // Crear blob con codificación de texto
      const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
      }, 200);

      showToast(`Archivo descargado: ${filename}`, 'success');
    } catch (e) {
      console.error('Error al descargar archivo:', e);
      this.copyErrorLog();
    }
  },

  // Copiar el diagnóstico al portapapeles
  copyErrorLog() {
    const reportText = this.getReportText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(reportText).then(() => {
        showToast('Diagnóstico copiado al portapapeles', 'success');
      }).catch(() => {
        showToast('Texto copiado en consola', 'info');
      });
    } else {
      // Intento alternativo
      try {
        const ta = document.createElement('textarea');
        ta.value = reportText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Diagnóstico copiado al portapapeles', 'success');
      } catch (err) {
        showToast('No se pudo copiar automáticamente', 'warning');
      }
    }
  },

  // ==========================================
  // SERVICIO DE RASTREO EN SEGUNDO PLANO
  // ==========================================

  async startBackgroundTracking() {
    if (this.isTracking) return;
    this.isTracking = true;

    // 1. Activar WakeLock para mantener la CPU y pantalla despierta
    await this.requestWakeLock();

    // 2. Activar Audio Keepalive (mantiene el hilo de JS en segundo plano en móviles)
    this.enableAudioKeepalive();

    // 3. Iniciar escucha de GPS nativo de alta precisión
    if ('geolocation' in navigator) {
      const geoOptions = {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000
      };

      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this.handleGeoSuccess(pos),
        (err) => this.handleGeoError(err),
        geoOptions
      );

      this.updateStatusBadge(true);
      showToast('Rastreo GPS en segundo plano activado', 'success');
    } else {
      showToast('Este navegador no soporta geolocalización GPS', 'danger');
    }
  },

  // Procesar lectura de GPS
  async handleGeoSuccess(pos) {
    const coords = pos.coords;
    const speedKmh = coords.speed !== null && coords.speed > 0 ? (coords.speed * 3.6) : 0;
    const heading = coords.heading !== null && !isNaN(coords.heading) ? coords.heading : (this.lastPosition ? this.calculateHeading(this.lastPosition, coords) : 0);

    // Obtener nivel de batería si la API está disponible
    let batteryLevel = null;
    if ('getBattery' in navigator) {
      try {
        const b = await navigator.getBattery();
        batteryLevel = b.level * 100;
      } catch (e) {}
    }

    const payload = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      speed: parseFloat(speedKmh.toFixed(1)),
      heading: Math.round(heading),
      accuracy: Math.round(coords.accuracy),
      battery_level: batteryLevel,
      recorded_at: new Date(pos.timestamp).toISOString()
    };

    this.lastPosition = payload;
    this.updateTelemetryUi(payload);

    // Enviar al servidor o guardar en cola offline
    await this.transmitLocation(payload);
  },

  handleGeoError(err) {
    console.warn('Advertencia de Geolocalización:', err.code, err.message);
    const errText = document.getElementById('m-gps-error');
    if (errText) {
      errText.innerText = `Aviso GPS: ${err.message}`;
      errText.classList.remove('hidden');
    }
  },

  // Enviar ubicación al backend
  async transmitLocation(loc) {
    if (!this.deviceToken) return;

    if (!navigator.onLine) {
      // Sin conexión: guardar en búfer local
      this.enqueueOffline(loc);
      return;
    }

    const serverUrl = this.getServerUrl();
    const endpoint = `${serverUrl}/api/mobile/location`;

    try {
      // Si hay elementos acumulados en offline, enviar en lote
      const queue = this.getOfflineQueue();
      const pointsToSend = [...queue, loc];

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceToken: this.deviceToken,
          locations: pointsToSend
        })
      });

      if (!res.ok) {
        let errData = {};
        try {
          errData = await res.json();
        } catch (e) {}

        // Si el servidor responde 404 (token no reconocido o servidor reiniciado en la nube)
        if (res.status === 404) {
          if (this.vehicleInfo && this.vehicleInfo.code) {
            console.warn('Dispositivo no reconocido en servidor (posible reinicio de Render o base de datos). Intentando revinculación automática...');
            const rePaired = await this.attemptAutoRePair();
            if (rePaired) {
              // Reintentar transmisión con el token revalidado
              return await this.sendTelemetry(loc);
            }
          }
          // Si no se pudo revincular (código borrado o vehículo eliminado por admin)
          this.handleRemoteUnlink();
          return;
        }
        throw new Error(errData.error || 'Error al transmitir');
      }

      // Éxito: limpiar cola offline
      this.clearOfflineQueue();
      this.pointsSentCount += pointsToSend.length;
      document.getElementById('m-points-sent').innerText = this.pointsSentCount;
      document.getElementById('m-last-sent-time').innerText = new Date().toLocaleTimeString();

      const offlineBadge = document.getElementById('m-offline-badge');
      if (offlineBadge) offlineBadge.classList.add('hidden');
    } catch (err) {
      console.warn('Fallo al transmitir, guardando en búfer offline:', err);
      this.enqueueOffline(loc);
    }
  },

  enqueueOffline(loc) {
    const queue = this.getOfflineQueue();
    queue.push(loc);
    localStorage.setItem('gps_offline_queue', JSON.stringify(queue));

    const offlineBadge = document.getElementById('m-offline-badge');
    if (offlineBadge) {
      offlineBadge.classList.remove('hidden');
      offlineBadge.innerText = `📶 Sin señal 4G (${queue.length} puntos en cola)`;
    }
  },

  getOfflineQueue() {
    try {
      const q = localStorage.getItem('gps_offline_queue');
      return q ? JSON.parse(q) : [];
    } catch (e) {
      return [];
    }
  },

  clearOfflineQueue() {
    localStorage.removeItem('gps_offline_queue');
  },

  // Intentar auto-revinculación transparente si el servidor se reinició o recreó la base de datos
  async attemptAutoRePair() {
    if (!this.vehicleInfo || !this.vehicleInfo.code || !this.deviceToken) return false;
    const serverUrl = this.getServerUrl();
    const endpoint = `${serverUrl}/api/mobile/pair`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: this.vehicleInfo.code,
          deviceToken: this.deviceToken,
          deviceInfo: `${navigator.userAgent} (Auto-Reconectado)`
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.vehicle) {
          this.vehicleInfo = data.vehicle;
          localStorage.setItem('gps_vehicle_info', JSON.stringify(this.vehicleInfo));
          console.log('✅ Auto-revinculación exitosa con vehículo:', data.vehicle.name);
          return true;
        }
      }
    } catch (err) {
      console.warn('No se pudo completar la revinculación automática:', err);
    }
    return false;
  },

  initNetworkListener() {
    window.addEventListener('online', () => {
      showToast('Conexión 4G/Wi-Fi reestablecida. Sincronizando puntos...', 'success');
      const queue = this.getOfflineQueue();
      if (queue.length > 0 && this.lastPosition) {
        this.transmitLocation(this.lastPosition);
      }
    });

    window.addEventListener('offline', () => {
      showToast('Sin conexión a Internet. Las coordenadas se guardarán en el teléfono.', 'warning');
    });
  },

  // Mantener pantalla y CPU activa
  async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          if (this.isTracking) this.requestWakeLock();
        });
      }
    } catch (err) {
      console.log('WakeLock no disponible o denegado:', err.message);
    }
  },

  // Audio KeepAlive silencioso para evitar suspensión de hilo en móviles
  enableAudioKeepalive() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext && !this.audioContext) {
        this.audioContext = new AudioContext();
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain);
        gain.connect(this.audioContext.destination);
        osc.start();
      }
    } catch (e) {
      console.log('Audio KeepAlive no soportado:', e);
    }
  },

  calculateHeading(prev, curr) {
    const dLon = (curr.longitude - prev.longitude) * Math.PI / 180;
    const lat1 = prev.latitude * Math.PI / 180;
    const lat2 = curr.latitude * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  },

  updateTelemetryUi(data) {
    document.getElementById('m-speed').innerText = `${Math.round(data.speed)} km/h`;
    document.getElementById('m-accuracy').innerText = `±${data.accuracy} m`;
    document.getElementById('m-coords').innerText = `${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}`;
    if (data.battery_level !== null) {
      document.getElementById('m-battery').innerText = `${Math.round(data.battery_level)}%`;
    }
  },

  updateStatusBadge(active) {
    const badge = document.getElementById('m-status-badge');
    if (!badge) return;
    if (active) {
      badge.innerHTML = '<span class="pulse-beacon"></span> TRANSMITIENDO EN SEGUNDO PLANO';
      badge.className = 'px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center gap-2';
    } else {
      badge.innerHTML = '<span class="pulse-beacon pulse-beacon-danger"></span> RASTREO DETENIDO';
      badge.className = 'px-3 py-1.5 rounded-full text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/40 flex items-center gap-2';
    }
  },

  // ==========================================
  // BLOQUEO DE SEGURIDAD POR PIN DE ADMIN
  // ==========================================

  openPinModal() {
    const modal = document.getElementById('mobile-pin-modal');
    if (modal) {
      modal.classList.add('active');
      document.getElementById('verify-pin-input').value = '';
    }
  },

  closePinModal() {
    const modal = document.getElementById('mobile-pin-modal');
    if (modal) modal.classList.remove('active');
  },

  async handlePinVerification(e) {
    e.preventDefault();
    const pin = document.getElementById('verify-pin-input').value;
    const serverUrl = this.getServerUrl();
    const endpoint = `${serverUrl}/api/settings/verify-pin`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });

      const data = await res.json();
      if (!res.ok || !data.valid) {
        throw new Error('PIN de administrador incorrecto. El rastreo no se puede detener.');
      }

      // PIN correcto: Autorizado a desvincular
      this.closePinModal();
      this.stopAndUnlinkLocally();
      showToast('Configuración quitada correctamente', 'info');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  },

  stopAndUnlinkLocally() {
    if (this.watchId) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isTracking = false;
    this.updateStatusBadge(false);
    localStorage.removeItem('gps_vehicle_info');
    this.vehicleInfo = null;
    this.showPairingScreen();
  },

  handleRemoteUnlink() {
    showToast('Este teléfono fue desvinculado desde el Panel Web Administrador', 'warning');
    this.stopAndUnlinkLocally();
  },

  // ==========================================
  // PESTAÑA: MI RECORRIDO DEL DÍA EN EL MÓVIL
  // ==========================================

  switchMobileTab(tab) {
    const trackerSec = document.getElementById('mobile-tab-tracker-content');
    const routeSec = document.getElementById('mobile-tab-route-content');
    const tabTrackerBtn = document.getElementById('tab-btn-tracker');
    const tabRouteBtn = document.getElementById('tab-btn-my-route');

    if (tab === 'tracker') {
      trackerSec.classList.remove('hidden');
      routeSec.classList.add('hidden');
      tabTrackerBtn.className = 'flex-1 py-3 text-sm font-bold border-b-2 border-blue-500 text-blue-400 text-center';
      tabRouteBtn.className = 'flex-1 py-3 text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200 text-center';
    } else {
      trackerSec.classList.add('hidden');
      routeSec.classList.remove('hidden');
      tabTrackerBtn.className = 'flex-1 py-3 text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-200 text-center';
      tabRouteBtn.className = 'flex-1 py-3 text-sm font-bold border-b-2 border-blue-500 text-blue-400 text-center';

      // Inicializar mapa móvil y cargar recorrido
      this.initMobileMap();
      this.loadMobileDailyRoute();
    }
  },

  initMobileMap() {
    if (!this.localMap) {
      this.localMap = L.map('mobile-route-map', {
        zoomControl: true,
        attributionControl: false
      }).setView([-34.6037, -58.3816], 13);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19
      }).addTo(this.localMap);
    } else {
      setTimeout(() => this.localMap.invalidateSize(), 200);
    }
  },

  async loadMobileDailyRoute() {
    if (!this.vehicleInfo) return;
    const dateInput = document.getElementById('mobile-date-input');
    const date = dateInput ? dateInput.value : new Date().toISOString().slice(0, 10);
    const serverUrl = this.getServerUrl();
    const endpoint = `${serverUrl}/api/vehicles/${this.vehicleInfo.id}/history?date=${date}`;

    try {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();

      document.getElementById('m-stat-km').innerText = `${data.stats.totalDistanceKm} km`;
      document.getElementById('m-stat-max-speed').innerText = `${data.stats.maxSpeed} km/h`;
      document.getElementById('m-stat-stops').innerText = `${data.stats.stopsCount}`;

      MapManager.drawDailyRoute(this.localMap, data.points, data.stops);
    } catch (err) {
      console.error('Error cargando recorrido en móvil:', err);
    }
  },

  // WebSocket para actualizaciones en vivo (renombrado remoto de vehículo)
  initWebSocket() {
    if (window.location.protocol === 'file:') return;

    let wsHost = window.location.host;
    let wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    const serverUrl = this.getServerUrl();
    if (serverUrl) {
      try {
        const parsed = new URL(serverUrl);
        wsHost = parsed.host;
        wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      } catch (e) {}
    }

    if (!wsHost || wsHost.includes('localhost') && window.Capacitor) return;

    try {
      const wsUrl = `${wsProto}//${wsHost}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'VEHICLE_UPDATED' && this.vehicleInfo && msg.payload.id === this.vehicleInfo.id) {
            this.vehicleInfo = msg.payload;
            localStorage.setItem('gps_vehicle_info', JSON.stringify(this.vehicleInfo));
            this.showActiveTrackingScreen();
            showToast(`Datos actualizados desde el panel web: ${this.vehicleInfo.name}`, 'info');
          } else if (msg.type === 'DEVICE_UNLINKED' && this.vehicleInfo && msg.payload.vehicleId === this.vehicleInfo.id) {
            this.handleRemoteUnlink();
          }
        } catch (e) {}
      };

      this.ws.onclose = () => {
        setTimeout(() => this.initWebSocket(), 5000);
      };
    } catch (e) {
      console.warn('WebSocket móvil error:', e);
    }
  }
};

window.MobileTracker = MobileTracker;
