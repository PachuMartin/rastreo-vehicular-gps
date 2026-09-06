// Módulo de Consulta de Recorrido por Día y Reproductor de Rutas
const HistoryManager = {
  currentData: null,
  playbackIndex: 0,
  isPlaying: false,
  playbackSpeed: 1, // 1x, 2x, 5x, 10x
  playbackTimer: null,

  init() {
    this.bindEvents();
    // Establecer fecha de hoy por defecto en el selector
    const dateInput = document.getElementById('history-date-input');
    if (dateInput) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }
  },

  bindEvents() {
    // Botón de consultar recorrido
    const btnLoad = document.getElementById('btn-load-history');
    if (btnLoad) {
      btnLoad.addEventListener('click', () => this.loadDailyHistory());
    }

    // Controles del reproductor
    const btnPlay = document.getElementById('btn-playback-play');
    if (btnPlay) {
      btnPlay.addEventListener('click', () => this.togglePlayback());
    }

    const scrubber = document.getElementById('playback-scrubber');
    if (scrubber) {
      scrubber.addEventListener('input', (e) => {
        this.pausePlayback();
        this.seekTo(parseInt(e.target.value, 10));
      });
    }

    const speedSelect = document.getElementById('playback-speed-select');
    if (speedSelect) {
      speedSelect.addEventListener('change', (e) => {
        this.playbackSpeed = parseFloat(e.target.value);
      });
    }
  },

  async loadDailyHistory(vehicleId = null, dateStr = null) {
    const vSelect = document.getElementById('history-vehicle-select');
    const dInput = document.getElementById('history-date-input');

    const vId = vehicleId || (vSelect ? vSelect.value : null);
    const date = dateStr || (dInput ? dInput.value : new Date().toISOString().slice(0, 10));

    if (!vId) {
      showToast('Selecciona un vehículo para ver su recorrido', 'warning');
      return;
    }

    this.pausePlayback();

    try {
      showToast(`Cargando recorrido del ${date}...`, 'info');
      const res = await fetch(`/api/vehicles/${vId}/history?date=${date}`);
      if (!res.ok) throw new Error((await res.json()).error);

      const data = await res.json();
      this.currentData = data;
      this.renderHistoryView(data);
    } catch (err) {
      console.error('Error cargando historial:', err);
      showToast(err.message, 'danger');
    }
  },

  renderHistoryView(data) {
    const { vehicle, date, points, stats, stops } = data;
    const historyMap = MapManager.initHistoryMap('history-map');

    // Actualizar badges de estadísticas
    document.getElementById('stat-distance').innerText = `${stats.totalDistanceKm} km`;
    document.getElementById('stat-max-speed').innerText = `${stats.maxSpeed} km/h`;
    document.getElementById('stat-avg-speed').innerText = `${stats.avgSpeed} km/h`;
    document.getElementById('stat-stops-count').innerText = `${stats.stopsCount}`;
    
    // Tiempos
    const movingHrs = Math.floor(stats.movingTimeMinutes / 60);
    const movingMins = stats.movingTimeMinutes % 60;
    document.getElementById('stat-moving-time').innerText = `${movingHrs > 0 ? `${movingHrs}h ` : ''}${movingMins}m`;

    const stoppedHrs = Math.floor(stats.stoppedTimeMinutes / 60);
    const stoppedMins = stats.stoppedTimeMinutes % 60;
    document.getElementById('stat-stopped-time').innerText = `${stoppedHrs > 0 ? `${stoppedHrs}h ` : ''}${stoppedMins}m`;

    // Lista de paradas detectadas
    const stopsContainer = document.getElementById('history-stops-list');
    if (stopsContainer) {
      if (stops.length === 0) {
        stopsContainer.innerHTML = `<div class="text-xs text-slate-400 py-3 text-center">No se detectaron paradas prolongadas (>3 min).</div>`;
      } else {
        stopsContainer.innerHTML = stops.map((stop, idx) => `
          <div onclick="HistoryManager.focusStop(${stop.latitude}, ${stop.longitude})" class="p-2.5 bg-slate-800/80 hover:bg-slate-700/80 rounded-lg border border-slate-700 cursor-pointer transition flex items-center justify-between text-xs">
            <div class="flex items-center gap-2">
              <span class="w-5 h-5 rounded-full bg-amber-500 text-slate-900 font-bold flex items-center justify-center text-[10px]">P${idx + 1}</span>
              <div>
                <div class="font-semibold text-slate-200">Parada de ${stop.durationMinutes} min</div>
                <div class="text-[11px] text-slate-400">${new Date(stop.startTime).toLocaleTimeString()} - ${new Date(stop.endTime).toLocaleTimeString()}</div>
              </div>
            </div>
            <span class="text-blue-400 hover:underline">Ver en mapa 📍</span>
          </div>
        `).join('');
      }
    }

    // Configurar scrubber de reproducción
    const scrubber = document.getElementById('playback-scrubber');
    const playPanel = document.getElementById('playback-controls-panel');
    const emptyNotice = document.getElementById('history-empty-notice');

    if (points.length > 0) {
      if (emptyNotice) emptyNotice.classList.add('hidden');
      if (playPanel) playPanel.classList.remove('hidden');

      scrubber.max = points.length - 1;
      scrubber.value = 0;
      this.playbackIndex = 0;
      this.updatePlaybackUi(points[0]);

      // Dibujar ruta completa sobre el mapa Leaflet
      MapManager.drawDailyRoute(historyMap, points, stops);
    } else {
      MapManager.clearDailyRoute(historyMap);
      if (emptyNotice) emptyNotice.classList.remove('hidden');
      if (playPanel) playPanel.classList.add('hidden');
      showToast(`No hay datos de recorrido registrados para el ${date}`, 'warning');
    }
  },

  focusStop(lat, lng) {
    const historyMap = MapManager.historyMap;
    if (historyMap) {
      historyMap.setView([lat, lng], 17);
    }
  },

  // Reproductor de Recorrido Paso a Paso
  togglePlayback() {
    if (this.isPlaying) {
      this.pausePlayback();
    } else {
      this.startPlayback();
    }
  },

  startPlayback() {
    if (!this.currentData || !this.currentData.points.length) return;
    this.isPlaying = true;
    const btnPlay = document.getElementById('btn-playback-play');
    if (btnPlay) btnPlay.innerHTML = '⏸️ Pausar';

    const points = this.currentData.points;
    if (this.playbackIndex >= points.length - 1) {
      this.playbackIndex = 0;
    }

    const step = () => {
      if (!this.isPlaying) return;

      if (this.playbackIndex >= points.length - 1) {
        this.pausePlayback();
        return;
      }

      this.playbackIndex++;
      this.seekTo(this.playbackIndex);

      // Intervalo calculado según velocidad (base 500ms / speed)
      const delay = Math.max(50, 400 / this.playbackSpeed);
      this.playbackTimer = setTimeout(step, delay);
    };

    step();
  },

  pausePlayback() {
    this.isPlaying = false;
    if (this.playbackTimer) {
      clearTimeout(this.playbackTimer);
      this.playbackTimer = null;
    }
    const btnPlay = document.getElementById('btn-playback-play');
    if (btnPlay) btnPlay.innerHTML = '▶️ Reproducir';
  },

  seekTo(index) {
    if (!this.currentData || !this.currentData.points.length) return;
    const points = this.currentData.points;
    const pt = points[index];
    if (!pt) return;

    this.playbackIndex = index;
    const scrubber = document.getElementById('playback-scrubber');
    if (scrubber) scrubber.value = index;

    this.updatePlaybackUi(pt);

    const historyMap = MapManager.historyMap;
    if (historyMap) {
      MapManager.setPlaybackMarker(
        historyMap,
        pt.latitude,
        pt.longitude,
        pt.heading || 0,
        pt.speed || 0,
        new Date(pt.recorded_at).toLocaleTimeString()
      );
    }
  },

  updatePlaybackUi(point) {
    const timeDisplay = document.getElementById('playback-current-time');
    const speedDisplay = document.getElementById('playback-current-speed');

    if (timeDisplay) {
      timeDisplay.innerText = new Date(point.recorded_at).toLocaleTimeString();
    }
    if (speedDisplay) {
      speedDisplay.innerText = `${Math.round(point.speed || 0)} km/h`;
    }
  }
};

window.HistoryManager = HistoryManager;
