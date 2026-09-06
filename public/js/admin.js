// Módulo de Administración de Vehículos, Dispositivos y Configuración
const AdminManager = {
  vehicles: [],
  selectedVehicle: null,

  async init() {
    this.bindEvents();
    await this.loadVehicles();
  },

  bindEvents() {
    // Botón para abrir modal de nuevo vehículo
    const btnNew = document.getElementById('btn-new-vehicle');
    if (btnNew) {
      btnNew.addEventListener('click', () => this.openNewVehicleModal());
    }

    // Formulario de creación/edición
    const formVehicle = document.getElementById('form-vehicle');
    if (formVehicle) {
      formVehicle.addEventListener('submit', (e) => this.handleVehicleSubmit(e));
    }

    // Formulario de cambio de PIN
    const formPin = document.getElementById('form-admin-pin');
    if (formPin) {
      formPin.addEventListener('submit', (e) => this.handlePinSubmit(e));
    }
  },

  getApiBase() {
    return (window.location.protocol === 'file:' || !window.location.host) 
      ? 'http://localhost:3000' 
      : '';
  },

  async loadVehicles() {
    const container = document.getElementById('admin-vehicles-list');
    if (container && (!this.vehicles || this.vehicles.length === 0)) {
      container.innerHTML = `
        <div class="col-span-full py-12 text-center text-slate-400">
          <div class="text-3xl animate-bounce mb-2">🚚</div>
          <div class="text-sm font-medium text-slate-300">Cargando vehículos de la flota...</div>
        </div>
      `;
    }

    try {
      const url = `${this.getApiBase()}/api/vehicles`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: Fallo al obtener vehículos`);
      
      this.vehicles = await res.json();
      this.renderVehiclesList();
      this.populateVehicleSelectors();
    } catch (err) {
      console.error('Error cargando vehículos:', err);
      if (container) {
        container.innerHTML = `
          <div class="col-span-full py-10 px-6 text-center text-red-400 bg-red-950/40 rounded-2xl border border-red-800/50">
            <div class="text-4xl mb-3">⚠️</div>
            <div class="text-base font-bold text-slate-100">No se pudieron cargar los vehículos</div>
            <div class="text-xs text-slate-400 mt-1 max-w-md mx-auto">${err.message}</div>
            <div class="text-xs text-slate-400 mt-2">Asegúrate de tener abierta la aplicación desde: <br><a href="http://localhost:3000" class="text-blue-400 font-bold underline">http://localhost:3000</a></div>
            <button onclick="AdminManager.loadVehicles()" class="mt-4 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-blue-900/40">
              🔄 Reintentar Carga
            </button>
          </div>
        `;
      }
      showToast('Error al conectar con la base de datos de vehículos', 'danger');
    }
  },

  renderVehiclesList() {
    const container = document.getElementById('admin-vehicles-list');
    if (!container) return;

    if (!this.vehicles || this.vehicles.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-12 text-center text-slate-400 bg-slate-800/40 rounded-2xl border border-slate-700/50 p-6">
          <div class="text-4xl mb-3">🚚</div>
          <div class="text-lg font-bold text-slate-200">No hay vehículos registrados</div>
          <div class="text-xs text-slate-400 mt-1 mb-4">Registra tu primer vehículo para comenzar a rastrearlo en tiempo real.</div>
          <button onclick="AdminManager.openNewVehicleModal()" class="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-blue-900/40">
            ➕ Registrar Primer Vehículo
          </button>
        </div>
      `;
      return;
    }

    const host = (window.location.protocol === 'file:' || !window.location.host) 
      ? 'http://localhost:3000' 
      : window.location.origin;

    container.innerHTML = this.vehicles.map(v => {
      const isOnline = v.connection_status === 'online';
      const isPaired = Boolean(v.device_token);
      const emoji = (window.MapManager && window.MapManager.getVehicleEmoji) ? MapManager.getVehicleEmoji(v.type) : '🚗';
      const pairUrl = `${host}/mobile?code=${encodeURIComponent(v.code)}`;
      const vColor = v.color || '#2563eb';

      return `
        <div class="bg-slate-800/70 border border-slate-700/60 rounded-2xl p-5 hover:border-blue-500/40 transition shadow-lg flex flex-col justify-between">
          <div>
            <div class="flex items-start justify-between mb-3">
              <div class="flex items-center gap-3">
                <div class="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shadow-inner bg-slate-900 border border-slate-700" style="color: ${vColor};">
                  ${emoji}
                </div>
                <div>
                  <h3 class="text-base font-bold text-slate-100 flex items-center gap-2">
                    ${v.name}
                    ${isOnline ? '<span class="pulse-beacon" title="En línea ahora"></span>' : ''}
                  </h3>
                  <div class="text-xs font-mono text-slate-400">Patente: <b class="text-slate-200">${v.plate}</b></div>
                </div>
              </div>
              <span class="px-2.5 py-1 text-xs font-medium rounded-full ${isPaired ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}">
                ${isPaired ? 'Dispositivo Vinculado' : 'Sin Vincular'}
              </span>
            </div>

            <div class="space-y-1.5 text-xs text-slate-300 bg-slate-900/60 p-3 rounded-lg border border-slate-800 mb-4">
              <div class="flex justify-between">
                <span class="text-slate-400">Chofer Asignado:</span>
                <span class="font-medium text-slate-200">${v.driver_name || 'No especificado'}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">Última Señal:</span>
                <span>${v.last_seen ? new Date(v.last_seen).toLocaleString() : 'Nunca'}</span>
              </div>
              ${v.last_speed ? `
                <div class="flex justify-between">
                  <span class="text-slate-400">Velocidad Actual:</span>
                  <span class="text-emerald-400 font-bold">${Math.round(v.last_speed)} km/h</span>
                </div>
              ` : ''}
            </div>

            <!-- Código de Activación para Móvil -->
            <div class="bg-blue-950/40 border border-blue-800/50 rounded-xl p-3 mb-4">
              <div class="text-[11px] text-blue-300 font-medium mb-1">CÓDIGO DE EMPAREJAMIENTO MÓVIL:</div>
              <div class="flex items-center justify-between">
                <span class="font-mono text-lg font-extrabold text-blue-400 tracking-wider">${v.code}</span>
                <div class="flex gap-1.5">
                  <button onclick="AdminManager.copyCode('${v.code}')" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition" title="Copiar Código">
                    📋 Copiar
                  </button>
                  <button onclick="AdminManager.showQrModalById(${v.id})" class="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold transition" title="Ver Código QR">
                    📱 QR
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Acciones de Administración -->
          <div class="flex items-center justify-between pt-3 border-t border-slate-700/50 text-xs">
            <div class="flex gap-3">
              <button onclick="AdminManager.openEditVehicleModal(${v.id})" class="text-blue-400 hover:text-blue-300 font-medium transition flex items-center gap-1">
                ✏️ Editar
              </button>
              ${isPaired ? `
                <button onclick="AdminManager.unlinkDeviceById(${v.id})" class="text-amber-400 hover:text-amber-300 font-medium transition flex items-center gap-1">
                  🔌 Desvincular Móvil
                </button>
              ` : ''}
            </div>
            <button onclick="AdminManager.deleteVehicleById(${v.id})" class="text-red-400 hover:text-red-300 font-medium transition flex items-center gap-1">
              🗑️ Eliminar
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  populateVehicleSelectors() {
    // Poblar selector de historial y simulador
    const historySelect = document.getElementById('history-vehicle-select');
    const simSelect = document.getElementById('sim-vehicle-select');

    if (!this.vehicles || this.vehicles.length === 0) return;

    const optionsHtml = this.vehicles.map(v => `
      <option value="${v.id}">${v.name} (${v.plate})</option>
    `).join('');

    if (historySelect) {
      const currentVal = historySelect.value;
      historySelect.innerHTML = optionsHtml;
      if (currentVal && this.vehicles.some(v => v.id == currentVal)) {
        historySelect.value = currentVal;
      } else {
        historySelect.value = this.vehicles[0].id;
      }
    }

    if (simSelect) {
      simSelect.innerHTML = optionsHtml;
    }
  },

  copyCode(code) {
    navigator.clipboard.writeText(code);
    showToast(`Código ${code} copiado al portapapeles`, 'success');
  },

  showQrModalById(vehicleId) {
    const v = this.vehicles.find(item => item.id == vehicleId);
    if (!v) return;
    const host = (window.location.protocol === 'file:' || !window.location.host) 
      ? 'http://localhost:3000' 
      : window.location.origin;
    const pairUrl = `${host}/mobile?code=${encodeURIComponent(v.code)}`;
    this.showQrModal(v.code, v.name, pairUrl);
  },

  showQrModal(code, name, pairUrl) {
    const modal = document.getElementById('qr-modal');
    const title = document.getElementById('qr-modal-title');
    const qrImage = document.getElementById('qr-code-img');
    const codeText = document.getElementById('qr-modal-code');
    const linkText = document.getElementById('qr-modal-link');

    if (title) title.innerText = `Vincular: ${name}`;
    if (codeText) codeText.innerText = code;
    if (linkText) {
      linkText.innerText = pairUrl;
      linkText.href = pairUrl;
    }

    // Generar código QR mediante API segura y rápida
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(pairUrl)}&color=0f172a&bgcolor=ffffff`;
    if (qrImage) qrImage.src = qrApiUrl;

    if (modal) modal.classList.add('active');
  },

  openNewVehicleModal() {
    this.selectedVehicle = null;
    const modal = document.getElementById('vehicle-modal');
    const title = document.getElementById('vehicle-modal-title');
    const form = document.getElementById('form-vehicle');

    if (title) title.innerText = 'Registrar Nuevo Vehículo';
    if (form) {
      form.reset();
      document.getElementById('vehicle-id').value = '';
    }

    if (modal) modal.classList.add('active');
  },

  openEditVehicleModal(id) {
    const v = this.vehicles.find(item => item.id === id);
    if (!v) return;

    this.selectedVehicle = v;
    const modal = document.getElementById('vehicle-modal');
    const title = document.getElementById('vehicle-modal-title');

    if (title) title.innerText = `Editar Vehículo: ${v.name}`;
    document.getElementById('vehicle-id').value = v.id;
    document.getElementById('vehicle-name').value = v.name;
    document.getElementById('vehicle-plate').value = v.plate;
    document.getElementById('vehicle-type').value = v.type || 'truck';
    document.getElementById('vehicle-driver').value = v.driver_name || '';
    document.getElementById('vehicle-color').value = v.color || '#2563eb';

    if (modal) modal.classList.add('active');
  },

  async handleVehicleSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('vehicle-id').value;
    const payload = {
      name: document.getElementById('vehicle-name').value.trim(),
      plate: document.getElementById('vehicle-plate').value.trim(),
      type: document.getElementById('vehicle-type').value,
      driver_name: document.getElementById('vehicle-driver').value.trim(),
      color: document.getElementById('vehicle-color').value
    };

    if (!payload.name || !payload.plate) {
      showToast('Nombre y Patente son obligatorios', 'warning');
      return;
    }

    const base = this.getApiBase();

    try {
      if (id) {
        // Editar
        const res = await fetch(`${base}/api/vehicles/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast('Vehículo actualizado exitosamente', 'success');
      } else {
        // Crear
        const res = await fetch(`${base}/api/vehicles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error((await res.json()).error);
        showToast('Vehículo registrado exitosamente', 'success');
      }

      this.closeModal('vehicle-modal');
      await this.loadVehicles();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  },

  async unlinkDeviceById(vehicleId) {
    const v = this.vehicles.find(item => item.id == vehicleId);
    const name = v ? v.name : 'Vehículo';
    await this.unlinkDevice(vehicleId, name);
  },

  async unlinkDevice(id, name) {
    if (!confirm(`¿Estás seguro de desvincular el dispositivo del vehículo "${name}"? El celular dejará de transmitir hasta que vuelva a ingresar el código.`)) {
      return;
    }

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/api/vehicles/${id}/unlink`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error);
      showToast('Dispositivo desvinculado con éxito', 'success');
      await this.loadVehicles();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  },

  async deleteVehicleById(vehicleId) {
    const v = this.vehicles.find(item => item.id == vehicleId);
    const name = v ? v.name : 'Vehículo';
    await this.deleteVehicle(vehicleId, name);
  },

  async deleteVehicle(id, name) {
    if (!confirm(`¿Eliminar definitivamente el vehículo "${name}"? Se conservará el historial de rutas pero no figurará más en la flota activa.`)) {
      return;
    }

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/api/vehicles/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error);
      showToast('Vehículo eliminado', 'success');
      if (window.MapManager && MapManager.removeFleetMarker) {
        MapManager.removeFleetMarker(id);
      }
      await this.loadVehicles();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  },

  async handlePinSubmit(e) {
    e.preventDefault();
    const currentPin = document.getElementById('current-pin').value;
    const newPin = document.getElementById('new-pin').value;
    const confirmPin = document.getElementById('confirm-pin').value;

    if (newPin !== confirmPin) {
      showToast('El nuevo PIN y su confirmación no coinciden', 'warning');
      return;
    }

    try {
      const base = this.getApiBase();
      const res = await fetch(`${base}/api/settings/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPin, newPin })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast('PIN maestro de administrador actualizado', 'success');
      document.getElementById('form-admin-pin').reset();
      this.closeModal('pin-modal');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }
};

window.AdminManager = AdminManager;
