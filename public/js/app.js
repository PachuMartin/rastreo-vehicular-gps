// Aplicación Principal y Orquestador de Eventos
let socket = null;

// Toast Helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';

  let icon = 'ℹ️';
  let borderCol = '#3b82f6';
  if (type === 'success') { icon = '✅'; borderCol = '#10b981'; }
  if (type === 'warning') { icon = '⚠️'; borderCol = '#f59e0b'; }
  if (type === 'danger') { icon = '❌'; borderCol = '#ef4444'; }

  toast.style.borderColor = borderCol;
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

window.showToast = showToast;

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initWebSocket();

  // 1. Cargar estado de IPs de red
  try {
    await loadServerStatus();
  } catch (e) {
    console.warn('Aviso al cargar estado:', e);
  }

  // 2. Inicializar mapa de flota
  try {
    if (window.MapManager && MapManager.initFleetMap) {
      MapManager.initFleetMap('fleet-map');
    }
  } catch (e) {
    console.error('Error inicializando mapa de flota:', e);
  }

  // 3. Inicializar módulos de forma independiente
  try {
    if (window.AdminManager) {
      await AdminManager.init();
    }
  } catch (e) {
    console.error('Error inicializando AdminManager:', e);
  }

  try {
    if (window.HistoryManager) HistoryManager.init();
  } catch (e) {
    console.error('Error inicializando HistoryManager:', e);
  }

  try {
    if (window.SimulatorManager) SimulatorManager.init();
  } catch (e) {
    console.error('Error inicializando SimulatorManager:', e);
  }

  // Cargar marcadores de flota
  try {
    updateFleetMapFromVehicles();
    setTimeout(() => {
      if (window.MapManager && MapManager.fitAllVehicles) {
        MapManager.fitAllVehicles();
      }
    }, 600);
  } catch (e) {
    console.warn('Aviso actualizando flota:', e);
  }
});

// Navegación por Pestañas
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab-btn');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');

      // Botones estilo activo
      tabs.forEach(t => {
        t.classList.remove('active', 'border-blue-500', 'text-blue-400');
        t.classList.add('border-transparent', 'text-slate-400');
      });
      btn.classList.add('active', 'border-blue-500', 'text-blue-400');
      btn.classList.remove('border-transparent', 'text-slate-400');

      // Contenido de secciones
      document.querySelectorAll('.tab-content-section').forEach(sec => {
        sec.classList.add('hidden');
      });

      const targetSec = document.getElementById(targetId);
      if (targetSec) {
        targetSec.classList.remove('hidden');

        // Acciones específicas según la pestaña
        if (targetId === 'tab-fleet' && window.MapManager && MapManager.fleetMap) {
          setTimeout(() => MapManager.fleetMap.invalidateSize(), 150);
        } else if (targetId === 'tab-history' && window.MapManager && MapManager.historyMap) {
          setTimeout(() => MapManager.historyMap.invalidateSize(), 150);
        } else if (targetId === 'tab-admin' && window.AdminManager) {
          // Recargar lista cada vez que el usuario entra a Gestión de Vehículos
          AdminManager.loadVehicles();
        }
      }
    });
  });
}

// Cargar estado del servidor e IPs para conexión del celular
async function loadServerStatus() {
  try {
    const base = (window.location.protocol === 'file:' || !window.location.host) ? 'http://localhost:3000' : '';
    const res = await fetch(`${base}/api/status`);
    const data = await res.json();
    const ipContainer = document.getElementById('mobile-connect-ips');
    if (ipContainer && data.localIps && data.localIps.length > 0) {
      ipContainer.innerHTML = data.localIps.map(ip => `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-900/40 text-blue-300 font-mono text-xs border border-blue-800/60">
          📶 ${ip.interface}: <b>http://${ip.address}:${data.port}/mobile</b>
        </span>
      `).join(' ');
    }
  } catch (e) {
    console.error('Error cargando estado del servidor:', e);
  }
}

// WebSocket en tiempo real
function initWebSocket() {
  if (window.location.protocol === 'file:') return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host || 'localhost:3000';
  const wsUrl = `${protocol}//${host}`;
  
  try {
    socket = new WebSocket(wsUrl);

    const statusBadge = document.getElementById('server-status-beacon');

    socket.onopen = () => {
      if (statusBadge) {
        statusBadge.className = 'pulse-beacon';
        statusBadge.title = 'Servidor conectado en tiempo real';
      }
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleSocketMessage(msg);
      } catch (e) {
        console.error('Error procesando mensaje WebSocket:', e);
      }
    };

    socket.onclose = () => {
      if (statusBadge) {
        statusBadge.className = 'pulse-beacon pulse-beacon-danger';
        statusBadge.title = 'Conexión WebSocket reconectando...';
      }
      setTimeout(initWebSocket, 4000);
    };

    socket.onerror = () => {
      if (statusBadge) {
        statusBadge.className = 'pulse-beacon pulse-beacon-danger';
      }
    };
  } catch (e) {
    console.warn('WebSocket error:', e);
  }
}

function handleSocketMessage(msg) {
  switch (msg.type) {
    case 'LOCATION_UPDATE': {
      const { vehicle, location } = msg.payload;
      // Actualizar marcador en el mapa de la flota
      MapManager.updateFleetMarker(vehicle, location);
      // Actualizar lista lateral de flota
      updateVehicleSideCard(vehicle.id, location);
      break;
    }
    case 'VEHICLE_CREATED':
    case 'VEHICLE_UPDATED':
    case 'VEHICLE_DELETED':
    case 'DEVICE_UNLINKED':
      // Recargar lista de vehículos
      AdminManager.loadVehicles().then(() => {
        updateFleetMapFromVehicles();
      });
      break;
  }
}

// Actualizar marcadores de mapa desde el listado de vehículos
function updateFleetMapFromVehicles() {
  if (!AdminManager.vehicles) return;

  const sideList = document.getElementById('fleet-side-list');
  if (sideList) {
    sideList.innerHTML = AdminManager.vehicles.map(v => {
      const isOnline = v.connection_status === 'online';
      const speed = Math.round(v.last_speed || 0);
      const isMoving = speed > 3;
      const emoji = MapManager.getVehicleEmoji(v.type);

      // Si tiene coordenadas, colocar marcador
      if (v.last_latitude && v.last_longitude) {
        MapManager.updateFleetMarker(v, {
          latitude: v.last_latitude,
          longitude: v.last_longitude,
          speed: v.last_speed,
          heading: v.last_heading,
          recorded_at: v.last_seen
        });
      }

      return `
        <div id="side-v-${v.id}" onclick="MapManager.focusVehicle(${v.id})" class="p-3 bg-slate-800/60 hover:bg-slate-700/60 rounded-xl border border-slate-700/60 cursor-pointer transition flex items-center justify-between group">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg flex items-center justify-center text-xl shadow-inner" style="background-color: ${v.color}20; border: 1px solid ${v.color}40;">
              ${emoji}
            </div>
            <div>
              <div class="text-sm font-bold text-slate-200 group-hover:text-blue-400 transition flex items-center gap-1.5">
                ${v.name}
                <span class="${isOnline ? 'pulse-beacon' : 'w-2 h-2 rounded-full bg-slate-600'}"></span>
              </div>
              <div class="text-xs text-slate-400 font-mono">${v.plate} • ${v.driver_name || 'Sin chofer'}</div>
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs font-bold ${isMoving ? 'text-emerald-400' : 'text-slate-400'}">
              ${isMoving ? `${speed} km/h` : 'Detenido'}
            </div>
            <div class="text-[10px] text-slate-500">${v.last_seen ? new Date(v.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Offline'}</div>
          </div>
        </div>
      `;
    }).join('');
  }
}

function updateVehicleSideCard(vehicleId, loc) {
  const card = document.getElementById(`side-v-${vehicleId}`);
  if (card) {
    const speed = Math.round(loc.speed || 0);
    const speedElem = card.querySelector('.text-right div:first-child');
    if (speedElem) {
      const isMoving = speed > 3;
      speedElem.className = `text-xs font-bold ${isMoving ? 'text-emerald-400' : 'text-slate-400'}`;
      speedElem.innerText = isMoving ? `${speed} km/h` : 'Detenido';
    }
  }
}
