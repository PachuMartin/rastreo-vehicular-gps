// Gestor de Mapas con Leaflet para Rastreo Vehicular y Rutas
const MapManager = {
  fleetMap: null,
  fleetMarkers: {},
  
  historyMap: null,
  historyRouteLayer: null,
  historyStopMarkers: [],
  playbackMarker: null,

  // Iconos según tipo de vehículo
  getVehicleEmoji(type) {
    switch (type) {
      case 'truck': return '🚚';
      case 'van': return '🚐';
      case 'motorcycle': return '🏍️';
      case 'car':
      default: return '🚗';
    }
  },

  // Inicializar mapa de flota en vivo
  initFleetMap(containerId = 'fleet-map', center = [-34.6037, -58.3816], zoom = 12) {
    if (this.fleetMap) return this.fleetMap;

    this.fleetMap = L.map(containerId, {
      zoomControl: true,
      attributionControl: false
    }).setView(center, zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(this.fleetMap);

    return this.fleetMap;
  },

  // Inicializar mapa de historial de rutas
  initHistoryMap(containerId = 'history-map', center = [-34.6037, -58.3816], zoom = 12) {
    if (this.historyMap) return this.historyMap;

    this.historyMap = L.map(containerId, {
      zoomControl: true,
      attributionControl: false
    }).setView(center, zoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(this.historyMap);

    return this.historyMap;
  },

  // Crear o actualizar marcador de un vehículo en el mapa de flota
  updateFleetMarker(vehicle, location) {
    if (!this.fleetMap) return;

    const lat = location.latitude || vehicle.last_latitude;
    const lng = location.longitude || vehicle.last_longitude;
    if (!lat || !lng) return;

    const vehicleId = vehicle.id;
    const speed = Math.round(location.speed || vehicle.last_speed || 0);
    const heading = location.heading || vehicle.last_heading || 0;
    const color = vehicle.color || '#2563eb';
    const emoji = this.getVehicleEmoji(vehicle.type);

    const isMoving = speed > 3;
    const statusText = isMoving ? `En marcha (${speed} km/h)` : 'Detenido';
    const statusColor = isMoving ? '#10b981' : '#f59e0b';

    // HTML personalizado para el marcador con flecha de orientación
    const iconHtml = `
      <div class="vehicle-marker" style="background-color: ${color}; transform: rotate(${heading}deg);">
        <div class="heading-arrow"></div>
        <span class="vehicle-icon" style="transform: rotate(${-heading}deg);">${emoji}</span>
      </div>
    `;

    const customIcon = L.divIcon({
      html: iconHtml,
      className: 'custom-vehicle-div-icon',
      iconSize: [42, 42],
      iconAnchor: [21, 21],
      popupAnchor: [0, -22]
    });

    const popupContent = `
      <div style="font-family: sans-serif; min-width: 190px; color: #1e293b;">
        <div style="font-weight: 700; font-size: 15px; margin-bottom: 2px;">${vehicle.name}</div>
        <div style="font-size: 12px; color: #64748b; margin-bottom: 6px;">Patente: <b>${vehicle.plate}</b></div>
        <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 4px;">
          <span style="width: 8px; height: 8px; border-radius: 50%; background-color: ${statusColor};"></span>
          <span>${statusText}</span>
        </div>
        ${vehicle.driver_name ? `<div style="font-size: 11px; color: #475569;">Chofer: ${vehicle.driver_name}</div>` : ''}
        ${location.battery_level ? `<div style="font-size: 11px; color: #475569;">Batería: 🔋 ${Math.round(location.battery_level)}%</div>` : ''}
        <div style="font-size: 10px; color: #94a3b8; margin-top: 6px;">Última señal: ${new Date(location.recorded_at || Date.now()).toLocaleTimeString()}</div>
      </div>
    `;

    if (this.fleetMarkers[vehicleId]) {
      // Actualizar posición y rotación fluida
      this.fleetMarkers[vehicleId].setLatLng([lat, lng]);
      this.fleetMarkers[vehicleId].setIcon(customIcon);
      this.fleetMarkers[vehicleId].getPopup().setContent(popupContent);
    } else {
      // Crear nuevo marcador
      const marker = L.marker([lat, lng], { icon: customIcon }).addTo(this.fleetMap);
      marker.bindPopup(popupContent);
      this.fleetMarkers[vehicleId] = marker;
    }
  },

  // Centrar mapa en un vehículo
  focusVehicle(vehicleId, zoom = 15) {
    if (this.fleetMarkers[vehicleId] && this.fleetMap) {
      const latLng = this.fleetMarkers[vehicleId].getLatLng();
      this.fleetMap.setView(latLng, zoom);
      this.fleetMarkers[vehicleId].openPopup();
    }
  },

  // Ajustar límites del mapa para ver todos los vehículos
  fitAllVehicles() {
    if (!this.fleetMap) return;
    const markers = Object.values(this.fleetMarkers);
    if (markers.length === 0) return;

    const group = L.featureGroup(markers);
    this.fleetMap.fitBounds(group.getBounds().pad(0.2));
  },

  // Eliminar marcador
  removeFleetMarker(vehicleId) {
    if (this.fleetMarkers[vehicleId]) {
      this.fleetMap.removeLayer(this.fleetMarkers[vehicleId]);
      delete this.fleetMarkers[vehicleId];
    }
  },

  // ==========================================
  // FUNCIONES DE HISTORIAL Y RECORRIDO POR DÍA
  // ==========================================

  // Dibujar el recorrido del día completo
  drawDailyRoute(mapInstance, points, stops = []) {
    if (!mapInstance) return;

    // Limpiar capas previas
    this.clearDailyRoute(mapInstance);

    if (!points || points.length === 0) return;

    const latLngs = points.map(p => [p.latitude, p.longitude]);

    // Capa de polilínea principal con estilo moderno
    this.historyRouteLayer = L.featureGroup().addTo(mapInstance);

    // Trazado de sombra para efecto visual
    L.polyline(latLngs, {
      color: '#1e3a8a',
      weight: 8,
      opacity: 0.35,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.historyRouteLayer);

    // Trazado principal
    L.polyline(latLngs, {
      color: '#2563eb',
      weight: 5,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.historyRouteLayer);

    // Banderín de Punto de Inicio (Verde)
    const startPt = points[0];
    const startIcon = L.divIcon({
      html: `<div style="background: #10b981; color: #fff; font-weight: bold; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.5);">🏁</div>`,
      className: 'start-flag-icon',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const startMarker = L.marker([startPt.latitude, startPt.longitude], { icon: startIcon }).addTo(this.historyRouteLayer);
    startMarker.bindPopup(`<b>Punto de Inicio</b><br>Hora: ${new Date(startPt.recorded_at).toLocaleTimeString()}`);

    // Banderín de Punto Final (Rojo o Cuadros)
    const endPt = points[points.length - 1];
    const endIcon = L.divIcon({
      html: `<div style="background: #ef4444; color: #fff; font-weight: bold; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.5);">🛑</div>`,
      className: 'end-flag-icon',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const endMarker = L.marker([endPt.latitude, endPt.longitude], { icon: endIcon }).addTo(this.historyRouteLayer);
    endMarker.bindPopup(`<b>Punto Final</b><br>Hora: ${new Date(endPt.recorded_at).toLocaleTimeString()}`);

    // Marcadores de paradas prolongadas
    stops.forEach((stop, index) => {
      const stopIcon = L.divIcon({
        html: `<div class="stop-marker-icon">P${index + 1}</div>`,
        className: 'stop-div-icon',
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const stopMarker = L.marker([stop.latitude, stop.longitude], { icon: stopIcon }).addTo(this.historyRouteLayer);
      stopMarker.bindPopup(`
        <div style="font-family: sans-serif; color: #1e293b;">
          <b>Parada #${index + 1}</b><br>
          ⏱️ Duración: <b>${stop.durationMinutes} min</b><br>
          Desde: ${new Date(stop.startTime).toLocaleTimeString()}<br>
          Hasta: ${new Date(stop.endTime).toLocaleTimeString()}
        </div>
      `);
      this.historyStopMarkers.push(stopMarker);
    });

    // Ajustar zoom para abarcar todo el recorrido
    mapInstance.fitBounds(this.historyRouteLayer.getBounds().pad(0.15));
  },

  // Limpiar capas de historial
  clearDailyRoute(mapInstance) {
    if (this.historyRouteLayer && mapInstance) {
      mapInstance.removeLayer(this.historyRouteLayer);
      this.historyRouteLayer = null;
    }
    this.historyStopMarkers = [];
    this.removePlaybackMarker(mapInstance);
  },

  // Marcador animado para el reproductor de ruta
  setPlaybackMarker(mapInstance, lat, lng, heading = 0, speed = 0, timeStr = '') {
    if (!mapInstance) return;

    const iconHtml = `
      <div style="width: 36px; height: 36px; border-radius: 50%; background: #f59e0b; border: 3px solid #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; transform: rotate(${heading}deg);">
        <div style="position: absolute; top: -6px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-bottom: 7px solid #ffffff;"></div>
        <span style="font-size: 18px; transform: rotate(${-heading}deg);">🚗</span>
      </div>
    `;

    const icon = L.divIcon({
      html: iconHtml,
      className: 'playback-active-marker',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });

    if (this.playbackMarker) {
      this.playbackMarker.setLatLng([lat, lng]);
      this.playbackMarker.setIcon(icon);
    } else {
      this.playbackMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(mapInstance);
    }
  },

  removePlaybackMarker(mapInstance) {
    if (this.playbackMarker && mapInstance) {
      mapInstance.removeLayer(this.playbackMarker);
      this.playbackMarker = null;
    }
  }
};

window.MapManager = MapManager;
