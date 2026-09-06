// Módulo Móvil: Rastreo Continuo en Segundo Plano, WakeLock, Búfer Offline y Bloqueo por PIN
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

  async init() {
    this.initDeviceToken();
    this.bindEvents();
    this.checkPairStatus();
    this.initNetworkListener();
    this.initWebSocket();
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

  // Emparejar teléfono con el código generado desde la web
  async handlePairSubmit(e) {
    e.preventDefault();
    const codeInput = document.getElementById('pair-code-input');
    const code = codeInput ? codeInput.value.trim().toUpperCase() : '';

    if (!code) {
      showToast('Por favor ingresa el código de activación', 'warning');
      return;
    }

    const deviceInfo = `${navigator.userAgent} - ${navigator.platform}`;

    try {
      showToast('Vinculando con el servidor...', 'info');
      const res = await fetch('/api/mobile/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          deviceToken: this.deviceToken,
          deviceInfo
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      this.vehicleInfo = data.vehicle;
      localStorage.setItem('gps_vehicle_info', JSON.stringify(this.vehicleInfo));

      showToast(`¡Vehículo vinculado: ${this.vehicleInfo.name}!`, 'success');
      this.showActiveTrackingScreen();
      this.startBackgroundTracking();
    } catch (err) {
      showToast(err.message, 'danger');
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

    try {
      // Si hay elementos acumulados en offline, enviar en lote
      const queue = this.getOfflineQueue();
      const pointsToSend = [...queue, loc];

      const res = await fetch('/api/mobile/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceToken: this.deviceToken,
          locations: pointsToSend
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        // Si el administrador desvinculó el móvil desde la web
        if (res.status === 404) {
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
          // Re-solicitar si fue liberado involuntariamente
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
        // Crear un oscilador con ganancia en 0 (inaudible)
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

    try {
      const res = await fetch('/api/settings/verify-pin', {
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

    try {
      const res = await fetch(`/api/vehicles/${this.vehicleInfo.id}/history?date=${date}`);
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
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'VEHICLE_UPDATED' && this.vehicleInfo && msg.payload.id === this.vehicleInfo.id) {
          // El administrador cambió el nombre o datos del vehículo desde la web
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
  }
};

window.MobileTracker = MobileTracker;
