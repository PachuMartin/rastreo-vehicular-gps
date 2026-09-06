const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbDir = process.env.DATA_DIR || path.join(__dirname);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'tracker.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error abriendo la base de datos SQLite:', err.message);
  } else {
    console.log('Conectado a la base de datos SQLite:', dbPath);
  }
});

// Promisify database methods for cleaner async/await
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Generador de códigos aleatorios únicos para emparejamiento (ej. TRK-4819)
function generatePairCode() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `TRK-${num}`;
}

// Inicializar esquema
async function initDatabase() {
  db.serialize(async () => {
    // Modo WAL para alto rendimiento y lecturas/escrituras concurrentes
    db.run('PRAGMA journal_mode = WAL;');
    db.run('PRAGMA foreign_keys = ON;');

    // 1. Tabla de Ajustes Globales (PIN de Admin, intervalos)
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // 2. Tabla de Vehículos
    db.run(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        plate TEXT NOT NULL,
        type TEXT DEFAULT 'truck',
        driver_name TEXT DEFAULT '',
        color TEXT DEFAULT '#2563eb',
        is_active INTEGER DEFAULT 1,
        device_token TEXT,
        device_info TEXT,
        last_latitude REAL,
        last_longitude REAL,
        last_speed REAL DEFAULT 0,
        last_heading REAL DEFAULT 0,
        last_battery REAL,
        last_seen DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Tabla de Logs de GPS
    db.run(`
      CREATE TABLE IF NOT EXISTS gps_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        speed REAL DEFAULT 0,
        heading REAL DEFAULT 0,
        accuracy REAL DEFAULT 0,
        battery_level REAL,
        date_str TEXT NOT NULL,
        recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE
      );
    `);

    // Índices para búsquedas de alta velocidad por día y vehículo
    db.run(`CREATE INDEX IF NOT EXISTS idx_gps_logs_vehicle_date ON gps_logs(vehicle_id, date_str, recorded_at);`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_vehicles_code ON vehicles(code);`);

    // Valores por defecto en settings si no existen
    db.get('SELECT value FROM settings WHERE key = ?', ['admin_pin'], (err, row) => {
      if (!row) {
        db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['admin_pin', '1234']);
      }
    });

    db.get('SELECT value FROM settings WHERE key = ?', ['update_interval'], (err, row) => {
      if (!row) {
        db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['update_interval', '5']);
      }
    });

    // Sembrar vehículos de demostración si la tabla está vacía
    db.get('SELECT COUNT(*) as count FROM vehicles', (err, row) => {
      if (row && row.count === 0) {
        console.log('Sembrando vehículos iniciales de demostración...');
        const v1 = {
          code: 'TRK-1001',
          name: 'Camión Reparto Norte',
          plate: 'AE 890 JK',
          type: 'truck',
          driver_name: 'Carlos Benítez',
          color: '#2563eb',
          last_latitude: -34.6037,
          last_longitude: -58.3816,
          last_speed: 38.5,
          last_heading: 145,
          last_battery: 88,
          last_seen: new Date().toISOString()
        };

        const v2 = {
          code: 'TRK-1002',
          name: 'Furgón Distribución Centro',
          plate: 'AF 342 LM',
          type: 'van',
          driver_name: 'Mariana Gómez',
          color: '#16a34a',
          last_latitude: -34.6110,
          last_longitude: -58.4173,
          last_speed: 0,
          last_heading: 270,
          last_battery: 95,
          last_seen: new Date().toISOString()
        };

        const stmt = db.prepare(`
          INSERT INTO vehicles (code, name, plate, type, driver_name, color, last_latitude, last_longitude, last_speed, last_heading, last_battery, last_seen)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run([v1.code, v1.name, v1.plate, v1.type, v1.driver_name, v1.color, v1.last_latitude, v1.last_longitude, v1.last_speed, v1.last_heading, v1.last_battery, v1.last_seen]);
        stmt.run([v2.code, v2.name, v2.plate, v2.type, v2.driver_name, v2.color, v2.last_latitude, v2.last_longitude, v2.last_speed, v2.last_heading, v2.last_battery, v2.last_seen]);
        stmt.finalize();
      }
    });
  });
}

// Inicializar al requerir
initDatabase();

// Operaciones DB
module.exports = {
  db,
  dbRun,
  dbAll,
  dbGet,
  generatePairCode,

  // Ajustes
  async getSettings() {
    const rows = await dbAll('SELECT key, value FROM settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    return settings;
  },

  async updateSetting(key, value) {
    await dbRun(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [key, String(value)]);
    return { key, value };
  },

  // Vehículos
  async getAllVehicles() {
    return await dbAll(`
      SELECT 
        v.*,
        (CASE 
          WHEN v.last_seen IS NOT NULL AND (strftime('%s', 'now') - strftime('%s', v.last_seen)) < 60 THEN 'online'
          WHEN v.last_seen IS NOT NULL AND (strftime('%s', 'now') - strftime('%s', v.last_seen)) < 600 THEN 'recent'
          ELSE 'offline'
        END) as connection_status
      FROM vehicles v
      WHERE v.is_active = 1
      ORDER BY v.name ASC
    `);
  },

  async getVehicleById(id) {
    return await dbGet('SELECT * FROM vehicles WHERE id = ?', [id]);
  },

  async getVehicleByCode(code) {
    if (!code) return null;
    const cleanCode = code.trim().toUpperCase();
    return await dbGet('SELECT * FROM vehicles WHERE UPPER(code) = ?', [cleanCode]);
  },

  async getVehicleByToken(deviceToken) {
    if (!deviceToken) return null;
    return await dbGet('SELECT * FROM vehicles WHERE device_token = ?', [deviceToken]);
  },

  async createVehicle({ name, plate, type = 'truck', driver_name = '', color = '#2563eb' }) {
    let code = generatePairCode();
    // Asegurar código único
    let exists = await dbGet('SELECT id FROM vehicles WHERE code = ?', [code]);
    while (exists) {
      code = generatePairCode();
      exists = await dbGet('SELECT id FROM vehicles WHERE code = ?', [code]);
    }

    const res = await dbRun(`
      INSERT INTO vehicles (code, name, plate, type, driver_name, color, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `, [code, name.trim(), plate.trim().toUpperCase(), type, driver_name.trim(), color]);

    return await dbGet('SELECT * FROM vehicles WHERE id = ?', [res.lastID]);
  },

  async updateVehicle(id, { name, plate, type, driver_name, color }) {
    const fields = [];
    const params = [];

    if (name !== undefined) { fields.push('name = ?'); params.push(name.trim()); }
    if (plate !== undefined) { fields.push('plate = ?'); params.push(plate.trim().toUpperCase()); }
    if (type !== undefined) { fields.push('type = ?'); params.push(type); }
    if (driver_name !== undefined) { fields.push('driver_name = ?'); params.push(driver_name.trim()); }
    if (color !== undefined) { fields.push('color = ?'); params.push(color); }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    await dbRun(`UPDATE vehicles SET ${fields.join(', ')} WHERE id = ?`, params);
    return await dbGet('SELECT * FROM vehicles WHERE id = ?', [id]);
  },

  async deleteVehicle(id) {
    // Soft delete o baja
    await dbRun('UPDATE vehicles SET is_active = 0 WHERE id = ?', [id]);
    return { success: true, id };
  },

  async pairVehicle(code, deviceToken, deviceInfo = '') {
    const vehicle = await this.getVehicleByCode(code);
    if (!vehicle) {
      throw new Error('Código de activación inválido o vehículo no encontrado');
    }

    await dbRun(`
      UPDATE vehicles 
      SET device_token = ?, device_info = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [deviceToken, deviceInfo, vehicle.id]);

    return await dbGet('SELECT * FROM vehicles WHERE id = ?', [vehicle.id]);
  },

  async unlinkVehicle(id) {
    await dbRun(`
      UPDATE vehicles 
      SET device_token = NULL, device_info = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);
    return { success: true };
  },

  // Ingesta de Ubicación GPS
  async recordLocation(vehicleId, { latitude, longitude, speed = 0, heading = 0, accuracy = 0, battery_level = null, recorded_at = null }) {
    const now = recorded_at ? new Date(recorded_at) : new Date();
    const dateStr = now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const timestampIso = now.toISOString();

    // 1. Insertar en historial de logs
    const res = await dbRun(`
      INSERT INTO gps_logs (vehicle_id, latitude, longitude, speed, heading, accuracy, battery_level, date_str, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [vehicleId, latitude, longitude, speed, heading, accuracy, battery_level, dateStr, timestampIso]);

    // 2. Actualizar último estado del vehículo
    await dbRun(`
      UPDATE vehicles 
      SET 
        last_latitude = ?,
        last_longitude = ?,
        last_speed = ?,
        last_heading = ?,
        last_battery = COALESCE(?, last_battery),
        last_seen = ?
      WHERE id = ?
    `, [latitude, longitude, speed, heading, battery_level, timestampIso, vehicleId]);

    return {
      logId: res.lastID,
      vehicleId,
      latitude,
      longitude,
      speed,
      heading,
      accuracy,
      battery_level,
      date_str: dateStr,
      recorded_at: timestampIso
    };
  },

  // Consulta de Historial Diario con Métricas
  async getDailyHistory(vehicleId, dateStr) {
    const vehicle = await dbGet('SELECT id, code, name, plate, type, color, driver_name FROM vehicles WHERE id = ?', [vehicleId]);
    if (!vehicle) throw new Error('Vehículo no encontrado');

    const points = await dbAll(`
      SELECT 
        id, latitude, longitude, speed, heading, accuracy, battery_level, recorded_at
      FROM gps_logs
      WHERE vehicle_id = ? AND date_str = ?
      ORDER BY recorded_at ASC
    `, [vehicleId, dateStr]);

    if (points.length === 0) {
      return {
        vehicle,
        date: dateStr,
        points: [],
        stats: {
          totalPoints: 0,
          totalDistanceKm: 0,
          maxSpeed: 0,
          avgSpeed: 0,
          startTime: null,
          endTime: null,
          movingTimeMinutes: 0,
          stoppedTimeMinutes: 0,
          stopsCount: 0
        },
        stops: []
      };
    }

    // Calcular estadísticas: Distancia usando fórmula Haversine, paradas, velocidades
    let totalDistanceKm = 0;
    let maxSpeed = 0;
    let speedSum = 0;
    let validSpeedCount = 0;
    let movingSeconds = 0;
    let stoppedSeconds = 0;
    const stops = [];

    let currentStop = null;

    function haversine(lat1, lon1, lat2, lon2) {
      const R = 6371; // Radio terrestre en km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const speed = p.speed || 0;
      if (speed > maxSpeed) maxSpeed = speed;
      if (speed > 0) {
        speedSum += speed;
        validSpeedCount++;
      }

      if (i > 0) {
        const prev = points[i - 1];
        const dist = haversine(prev.latitude, prev.longitude, p.latitude, p.longitude);
        // Filtrar saltos irreales de GPS (> 180 km/h o error de precisión)
        if (dist > 0.005) { // al menos 5 metros
          totalDistanceKm += dist;
        }

        const tPrev = new Date(prev.recorded_at).getTime();
        const tCurr = new Date(p.recorded_at).getTime();
        const deltaSec = Math.max(0, (tCurr - tPrev) / 1000);

        if (speed < 3.0) {
          // Detenido
          stoppedSeconds += deltaSec;
          if (!currentStop) {
            currentStop = {
              latitude: p.latitude,
              longitude: p.longitude,
              startTime: prev.recorded_at,
              endTime: p.recorded_at,
              durationMinutes: 0
            };
          } else {
            currentStop.endTime = p.recorded_at;
          }
        } else {
          // En movimiento
          movingSeconds += deltaSec;
          if (currentStop) {
            const stopDuration = (new Date(currentStop.endTime).getTime() - new Date(currentStop.startTime).getTime()) / 60000;
            // Solo registrar como parada si estuvo detenido más de 3 minutos
            if (stopDuration >= 3) {
              currentStop.durationMinutes = Math.round(stopDuration);
              stops.push(currentStop);
            }
            currentStop = null;
          }
        }
      }
    }

    // Si terminó detenido
    if (currentStop) {
      const stopDuration = (new Date(currentStop.endTime).getTime() - new Date(currentStop.startTime).getTime()) / 60000;
      if (stopDuration >= 3) {
        currentStop.durationMinutes = Math.round(stopDuration);
        stops.push(currentStop);
      }
    }

    const avgSpeed = validSpeedCount > 0 ? (speedSum / validSpeedCount) : 0;

    return {
      vehicle,
      date: dateStr,
      points,
      stats: {
        totalPoints: points.length,
        totalDistanceKm: parseFloat(totalDistanceKm.toFixed(2)),
        maxSpeed: parseFloat(maxSpeed.toFixed(1)),
        avgSpeed: parseFloat(avgSpeed.toFixed(1)),
        startTime: points[0].recorded_at,
        endTime: points[points.length - 1].recorded_at,
        movingTimeMinutes: Math.round(movingSeconds / 60),
        stoppedTimeMinutes: Math.round(stoppedSeconds / 60),
        stopsCount: stops.length
      },
      stops
    };
  }
};
