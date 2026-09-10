const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const db = require('./database/db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Obtener IPs locales de la máquina para facilitar la conexión desde el celular
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Solo IPv4 no internas
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ interface: name, address: iface.address });
      }
    }
  }
  return addresses;
}

// WebSocket broadcast helper
function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Conexión WebSocket establecida con el servidor GPS' }));
});

// ==========================================
// RUTAS DE LA API REST
// ==========================================

// 0. Health check para servicios de monitorización y keep-alive (evita que Render se duerma)
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).send('OK');
});

// 1. Estado y red
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    system: 'GPS Flota Blt',
    time: new Date().toISOString(),
    localIps: getLocalIpAddresses(),
    port: PORT
  });
});

// 2. Configuración y PIN de Administrador
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await db.getSettings();
    // No devolvemos el PIN en texto plano por seguridad
    res.json({
      update_interval: settings.update_interval || '5',
      min_distance: settings.min_distance || '10',
      has_pin: Boolean(settings.admin_pin)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verificar PIN de administrador
app.post('/api/settings/verify-pin', async (req, res) => {
  try {
    const { pin } = req.body;
    const settings = await db.getSettings();
    const correctPin = settings.admin_pin || '1234';

    if (String(pin).trim() === String(correctPin).trim()) {
      return res.json({ valid: true });
    }
    return res.status(401).json({ valid: false, error: 'PIN de administrador incorrecto' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cambiar PIN de administrador
app.post('/api/settings/pin', async (req, res) => {
  try {
    const { currentPin, newPin } = req.body;
    const settings = await db.getSettings();
    const correctPin = settings.admin_pin || '1234';

    if (String(currentPin).trim() !== String(correctPin).trim()) {
      return res.status(401).json({ error: 'El PIN actual no es correcto' });
    }

    if (!newPin || String(newPin).trim().length < 4) {
      return res.status(400).json({ error: 'El nuevo PIN debe tener al menos 4 dígitos' });
    }

    await db.updateSetting('admin_pin', String(newPin).trim());
    res.json({ success: true, message: 'PIN actualizado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Gestión de Vehículos (Panel Administrador)
app.get('/api/vehicles', async (req, res) => {
  try {
    const vehicles = await db.getAllVehicles();
    res.json(vehicles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/vehicles/:id', async (req, res) => {
  try {
    const vehicle = await db.getVehicleById(req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehículo no encontrado' });
    res.json(vehicle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vehicles', async (req, res) => {
  try {
    const { name, plate, type, driver_name, color } = req.body;
    if (!name || !plate) {
      return res.status(400).json({ error: 'El nombre del vehículo y la patente son obligatorios' });
    }

    const newVehicle = await db.createVehicle({ name, plate, type, driver_name, color });
    broadcast('VEHICLE_CREATED', newVehicle);
    res.status(201).json(newVehicle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualización desde el Panel Web (Renombrar, cambiar chofer, etc.)
app.put('/api/vehicles/:id', async (req, res) => {
  try {
    const { name, plate, type, driver_name, color } = req.body;
    const updated = await db.updateVehicle(req.params.id, { name, plate, type, driver_name, color });
    
    // Notificar en tiempo real a todos los clientes (incluyendo el móvil asignado)
    broadcast('VEHICLE_UPDATED', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/vehicles/:id', async (req, res) => {
  try {
    await db.deleteVehicle(req.params.id);
    broadcast('VEHICLE_DELETED', { id: Number(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Desvincular dispositivo remotamente desde el panel web
app.post('/api/vehicles/:id/unlink', async (req, res) => {
  try {
    const vehicle = await db.getVehicleById(req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehículo no encontrado' });

    await db.unlinkVehicle(vehicle.id);
    broadcast('DEVICE_UNLINKED', { vehicleId: vehicle.id, deviceToken: vehicle.device_token });
    res.json({ success: true, message: 'Dispositivo desvinculado con éxito' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. API de Emparejamiento y Rastreo Móvil
app.post('/api/mobile/pair', async (req, res) => {
  try {
    const { code, deviceToken, deviceInfo } = req.body;
    if (!code || !deviceToken) {
      return res.status(400).json({ error: 'Código de activación y token de dispositivo requeridos' });
    }

    const vehicle = await db.pairVehicle(code, deviceToken, deviceInfo);
    broadcast('VEHICLE_PAIRED', vehicle);
    res.json({
      success: true,
      message: 'Dispositivo emparejado correctamente',
      vehicle
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Ingesta de ubicación desde el móvil (Soporta envío individual o lote offline)
app.post('/api/mobile/location', async (req, res) => {
  try {
    const { deviceToken, locations, location } = req.body;
    if (!deviceToken) {
      return res.status(400).json({ error: 'Token de dispositivo no provisto' });
    }

    const vehicle = await db.getVehicleByToken(deviceToken);
    if (!vehicle) {
      return res.status(404).json({ error: 'Dispositivo no reconocido o desvinculado por el administrador' });
    }

    // Si viene un lote de ubicaciones offline
    const pointsToRecord = Array.isArray(locations) ? locations : (location ? [location] : []);
    if (pointsToRecord.length === 0) {
      return res.status(400).json({ error: 'No se enviaron datos de posición' });
    }

    let lastResult = null;
    for (const pt of pointsToRecord) {
      lastResult = await db.recordLocation(vehicle.id, {
        latitude: pt.latitude,
        longitude: pt.longitude,
        speed: pt.speed || 0,
        heading: pt.heading || 0,
        accuracy: pt.accuracy || 0,
        battery_level: pt.battery_level !== undefined ? pt.battery_level : null,
        recorded_at: pt.recorded_at || null
      });
    }

    // Difundir la última ubicación en tiempo real por WebSocket
    if (lastResult) {
      broadcast('LOCATION_UPDATE', {
        vehicle: {
          id: vehicle.id,
          name: vehicle.name,
          plate: vehicle.plate,
          type: vehicle.type,
          color: vehicle.color,
          driver_name: vehicle.driver_name
        },
        location: lastResult
      });
    }

    res.json({ success: true, pointsRecorded: pointsToRecord.length, last: lastResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4.1 Inyectar ubicaciones de simulación sin alterar el token del teléfono
app.post('/api/vehicles/:id/simulate-location', async (req, res) => {
  try {
    const vehicleId = req.params.id;
    const vehicle = await db.getVehicleById(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }

    const { locations, location } = req.body;
    const pointsToRecord = Array.isArray(locations) ? locations : (location ? [location] : []);
    if (pointsToRecord.length === 0) {
      return res.status(400).json({ error: 'No se enviaron datos de posición para la simulación' });
    }

    let lastResult = null;
    for (const pt of pointsToRecord) {
      lastResult = await db.recordLocation(vehicle.id, {
        latitude: pt.latitude,
        longitude: pt.longitude,
        speed: pt.speed || 0,
        heading: pt.heading || 0,
        accuracy: pt.accuracy || 0,
        battery_level: pt.battery_level !== undefined ? pt.battery_level : null,
        recorded_at: pt.recorded_at || null
      });
    }

    if (lastResult) {
      broadcast('LOCATION_UPDATE', {
        vehicle: {
          id: vehicle.id,
          name: vehicle.name,
          plate: vehicle.plate,
          type: vehicle.type,
          color: vehicle.color,
          driver_name: vehicle.driver_name
        },
        location: lastResult
      });
    }

    res.json({ success: true, pointsRecorded: pointsToRecord.length, last: lastResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Historial Diario de Recorridos
app.get('/api/vehicles/:id/history', async (req, res) => {
  try {
    const vehicleId = req.params.id;
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    const history = await db.getDailyHistory(vehicleId, dateStr);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Servir la vista móvil directa
app.get('/mobile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mobile.html'));
});

// Iniciar servidor
server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIpAddresses();
  console.log('====================================================');
  console.log(`🚀 SERVIDOR GPS FLOTA BLT INICIADO`);
  console.log(`🌐 Panel Central Web:   http://localhost:${PORT}`);
  console.log(`📱 App Móvil (Vehículo): http://localhost:${PORT}/mobile`);
  console.log('----------------------------------------------------');
  console.log('📶 Para conectar tu teléfono móvil en la misma red Wi-Fi:');
  ips.forEach(ip => {
    console.log(`   👉 http://${ip.address}:${PORT}/mobile`);
  });
  console.log('====================================================');
});
