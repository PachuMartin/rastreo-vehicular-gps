// Simulador de Rutas y Generador de Trayectos para Pruebas Inmediatas
const SimulatorManager = {
  isSimulating: false,
  simTimer: null,
  currentIndex: 0,

  // Puntos de una ruta urbana realista con avenidas, curvas y semáforos
  routeWaypoints: [
    { lat: -34.6037, lng: -58.3816, speed: 0, heading: 90 },     // Obelisco
    { lat: -34.6040, lng: -58.3790, speed: 28, heading: 100 },
    { lat: -34.6045, lng: -58.3750, speed: 42, heading: 105 },
    { lat: -34.6052, lng: -58.3710, speed: 45, heading: 110 },
    { lat: -34.6065, lng: -58.3680, speed: 35, heading: 140 },   // Puerto Madero
    { lat: -34.6100, lng: -58.3665, speed: 50, heading: 170 },
    { lat: -34.6145, lng: -58.3650, speed: 52, heading: 175 },
    { lat: -34.6190, lng: -58.3645, speed: 48, heading: 180 },
    { lat: -34.6240, lng: -58.3655, speed: 30, heading: 195 },
    { lat: -34.6280, lng: -58.3680, speed: 0, heading: 220 },    // Parada 1 (Semáforo/Descarga)
    { lat: -34.6285, lng: -58.3720, speed: 38, heading: 260 },
    { lat: -34.6270, lng: -58.3780, speed: 46, heading: 285 },   // Av. San Juan
    { lat: -34.6245, lng: -58.3850, speed: 55, heading: 295 },
    { lat: -34.6200, lng: -58.3920, speed: 40, heading: 310 },
    { lat: -34.6150, lng: -58.3980, speed: 34, heading: 320 },   // Congreso
    { lat: -34.6095, lng: -58.3925, speed: 25, heading: 45 },
    { lat: -34.6060, lng: -58.3860, speed: 32, heading: 60 },
    { lat: -34.6037, lng: -58.3816, speed: 0, heading: 90 }      // Retorno
  ],

  init() {
    const btnSimRealtime = document.getElementById('btn-sim-realtime');
    const btnGenHistory = document.getElementById('btn-gen-history');

    if (btnSimRealtime) {
      btnSimRealtime.addEventListener('click', () => this.toggleRealtimeSimulation());
    }

    if (btnGenHistory) {
      btnGenHistory.addEventListener('click', () => this.generateFullDayHistory());
    }
  },

  // 1. Simulación en Tiempo Real paso a paso
  toggleRealtimeSimulation() {
    if (this.isSimulating) {
      this.stopRealtimeSimulation();
    } else {
      this.startRealtimeSimulation();
    }
  },

  startRealtimeSimulation() {
    const vSelect = document.getElementById('sim-vehicle-select');
    const vehicleId = vSelect ? vSelect.value : null;

    if (!vehicleId) {
      showToast('Selecciona un vehículo para simular', 'warning');
      return;
    }

    this.isSimulating = true;
    this.currentIndex = 0;
    const btn = document.getElementById('btn-sim-realtime');
    if (btn) {
      btn.innerText = '⏹️ Detener Simulación en Vivo';
      btn.className = 'px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-semibold transition';
    }

    showToast('Simulador en tiempo real iniciado. Ve a la pestaña "Mapa Flota" para verlo moverse.', 'info');

    const step = async () => {
      if (!this.isSimulating) return;

      const wp = this.routeWaypoints[this.currentIndex];
      // Agregar leve variación aleatoria a coordenadas para dinamismo
      const jitterLat = (Math.random() - 0.5) * 0.0003;
      const jitterLng = (Math.random() - 0.5) * 0.0003;

      const payload = {
        latitude: wp.lat + jitterLat,
        longitude: wp.lng + jitterLng,
        speed: wp.speed,
        heading: wp.heading,
        accuracy: 8,
        battery_level: 92 - Math.floor(this.currentIndex / 2),
        recorded_at: new Date().toISOString()
      };

      try {
        // Inyectar punto directamente a la DB del servidor sin alterar el dispositivo real
        await fetch(`/api/vehicles/${vehicleId}/simulate-location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location: payload
          })
        });
      } catch (e) {
        console.error('Error enviando punto simulado:', e);
      }

      this.currentIndex = (this.currentIndex + 1) % this.routeWaypoints.length;
      this.simTimer = setTimeout(step, 3000); // Cada 3 segundos avanza
    };

    step();
  },

  stopRealtimeSimulation() {
    this.isSimulating = false;
    if (this.simTimer) {
      clearTimeout(this.simTimer);
      this.simTimer = null;
    }
    const btn = document.getElementById('btn-sim-realtime');
    if (btn) {
      btn.innerText = '▶️ Iniciar Simulación en Tiempo Real';
      btn.className = 'px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold transition';
    }
    showToast('Simulación en vivo detenida', 'info');
  },

  // 2. Generar un día completo de recorrido al instante para probar el historial
  async generateFullDayHistory() {
    const vSelect = document.getElementById('sim-vehicle-select');
    const vehicleId = vSelect ? vSelect.value : null;

    if (!vehicleId) {
      showToast('Selecciona un vehículo para generar el recorrido', 'warning');
      return;
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    showToast('Generando recorrido de prueba con 40 puntos y 3 paradas...', 'info');

    // Generar 40 puntos a lo largo del día (desde las 08:15 hasta las 13:40)
    const baseDate = new Date();
    baseDate.setHours(8, 15, 0, 0);

    const locations = [];
    const waypoints = [
      ...this.routeWaypoints,
      ...this.routeWaypoints.map(p => ({ lat: p.lat + 0.008, lng: p.lng + 0.006, speed: p.speed, heading: (p.heading + 180) % 360 }))
    ];

    let currentTimestamp = baseDate.getTime();

    waypoints.forEach((wp, i) => {
      // Avanzar entre 3 y 8 minutos entre puntos
      let minutesDelta = 4;

      // Crear paradas en los puntos 8, 18 y 28
      if (i === 8 || i === 18 || i === 28) {
        minutesDelta = 18; // Parada de 18 min
        wp.speed = 0;
      }

      currentTimestamp += minutesDelta * 60 * 1000;

      locations.push({
        latitude: wp.lat + (Math.random() - 0.5) * 0.0002,
        longitude: wp.lng + (Math.random() - 0.5) * 0.0002,
        speed: wp.speed,
        heading: wp.heading,
        accuracy: 6,
        battery_level: Math.max(20, 100 - i * 2),
        recorded_at: new Date(currentTimestamp).toISOString()
      });
    });

    try {
      const res = await fetch(`/api/vehicles/${vehicleId}/simulate-location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations
        })
      });

      if (!res.ok) throw new Error((await res.json()).error);

      showToast('¡Recorrido diario generado con éxito! Ve a "Historial por Día" para visualizarlo.', 'success');
      
      // Auto-cargar en la pestaña de historial
      const historyVehicleSelect = document.getElementById('history-vehicle-select');
      if (historyVehicleSelect) historyVehicleSelect.value = vehicleId;
      HistoryManager.loadDailyHistory(vehicleId, todayStr);
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }
};

window.SimulatorManager = SimulatorManager;
