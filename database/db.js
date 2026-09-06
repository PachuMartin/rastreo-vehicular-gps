const path = require('path');
const fs = require('fs');

// Determinar el motor de base de datos según variables de entorno
const isPostgres = Boolean(process.env.DATABASE_URL);

let pgPool = null;
let sqliteDb = null;

if (isPostgres) {
  const { Pool } = require('pg');
  const isLocalPg = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
  
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocalPg ? false : { rejectUnauthorized: false }
  });

  pgPool.on('error', (err) => {
    console.error('⚠️ Error imprevisto en el pool de PostgreSQL:', err.message);
  });

  console.log('🐘 Motor de base de datos: PostgreSQL (Persistencia en la Nube)');
} else {
  const sqlite3 = require('sqlite3').verbose();
  const dbDir = process.env.DATA_DIR || path.join(__dirname);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'tracker.db');
  sqliteDb = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error abriendo la base de datos SQLite:', err.message);
    } else {
      console.log('📁 Motor de base de datos: SQLite Local ->', dbPath);
    }
  });
}

// Convertidor de parámetros: convierte marcadores '?' en '$1, $2, ...' para PostgreSQL
function toPgSql(sql) {
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
}

// Control de inicialización asíncrona garantizada
let initPromise = null;
function ensureInitialized() {
  if (!initPromise) {
    initPromise = initDatabase();
  }
  return initPromise;
}

// Métodos universales de ejecución de consultas
const dbRun = async (sql, params = []) => {
  await ensureInitialized();

  if (isPostgres) {
    let pgSql = toPgSql(sql.trim());
    const isInsert = /^INSERT\s+INTO/i.test(pgSql);
    const hasReturning = /RETURNING/i.test(pgSql);

    // Si es un INSERT y no tiene RETURNING, solicitar el id generado
    if (isInsert && !hasReturning) {
      pgSql += ' RETURNING id';
    }

    const res = await pgPool.query(pgSql, params);
    const lastID = (res.rows && res.rows.length > 0 && res.rows[0].id !== undefined)
      ? res.rows[0].id
      : null;

    return { lastID, changes: res.rowCount };
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
};

const dbAll = async (sql, params = []) => {
  await ensureInitialized();

  if (isPostgres) {
    const pgSql = toPgSql(sql.trim());
    const res = await pgPool.query(pgSql, params);
    return res.rows || [];
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }
};

const dbGet = async (sql, params = []) => {
  await ensureInitialized();

  if (isPostgres) {
    const pgSql = toPgSql(sql.trim());
    const res = await pgPool.query(pgSql, params);
    return (res.rows && res.rows.length > 0) ? res.rows[0] : null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }
};

// Generador de códigos aleatorios únicos para emparejamiento (ej. TRK-4819)
function generatePairCode() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `TRK-${num}`;
}

// Inicialización de Esquema de Base de Datos
async function initDatabase() {
  if (isPostgres) {
    try {
      // 1. Tabla de Ajustes Globales
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);

      // 2. Tabla de Vehículos
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS vehicles (
          id SERIAL PRIMARY KEY,
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
          last_seen TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 3. Tabla de Logs de GPS
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS gps_logs (
          id BIGSERIAL PRIMARY KEY,
          vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
          latitude REAL NOT NULL,
          longitude REAL NOT NULL,
          speed REAL DEFAULT 0,
          heading REAL DEFAULT 0,
          accuracy REAL DEFAULT 0,
          battery_level REAL,
          date_str TEXT NOT NULL,
          recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Índices de alta velocidad
      await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_gps_logs_vehicle_date ON gps_logs(vehicle_id, date_str, recorded_at);`);
      await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_vehicles_code ON vehicles(code);`);

      // Valores por defecto en settings
      const pinRes = await pgPool.query('SELECT value FROM settings WHERE key = $1', ['admin_pin']);
      if (pinRes.rows.length === 0) {
        await pgPool.query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['admin_pin', '1234']);
      }

      const intRes = await pgPool.query('SELECT value FROM settings WHERE key = $1', ['update_interval']);
      if (intRes.rows.length === 0) {
        await pgPool.query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['update_interval', '5']);
      }

      // Semillas iniciales si la tabla de vehículos está vacía
      const countRes = await pgPool.query('SELECT COUNT(*) as count FROM vehicles');
      const count = parseInt(countRes.rows[0].count, 10);
      if (count === 0) {
        console.log('Sembrando vehículos iniciales en PostgreSQL...');
        await pgPool.query(`
          INSERT INTO vehicles (code, name, plate, type, driver_name, color, last_latitude, last_longitude, last_speed, last_heading, last_battery, last_seen)
          VALUES 
            ('TRK-1001', 'Camión Reparto Norte', 'AE 890 JK', 'truck', 'Carlos Benítez', '#2563eb', -34.6037, -58.3816, 38.5, 145, 88, NOW()),
            ('TRK-1002', 'Furgón Distribución Centro', 'AF 342 LM', 'van', 'Mariana Gómez', '#16a34a', -34.6110, -58.4173, 0, 270, 95, NOW());
        `);
      }
      console.log('✅ Esquema PostgreSQL inicializado y verificado');
    } catch (pgInitErr) {
      console.error('Error inicializando esquema PostgreSQL:', pgInitErr);
      throw pgInitErr;
    }
  } else {
    // Inicialización SQLite
    return new Promise((resolve, reject) => {
      sqliteDb.serialize(() => {
        sqliteDb.run('PRAGMA journal_mode = WAL;');
        sqliteDb.run('PRAGMA foreign_keys = ON;');

        sqliteDb.run(`
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );
        `);

        sqliteDb.run(`
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

        sqliteDb.run(`
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

        sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_gps_logs_vehicle_date ON gps_logs(vehicle_id, date_str, recorded_at);`);
        sqliteDb.run(`CREATE INDEX IF NOT EXISTS idx_vehicles_code ON vehicles(code);`);

        sqliteDb.get('SELECT value FROM settings WHERE key = ?', ['admin_pin'], (err, row) => {
          if (!row) {
            sqliteDb.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['admin_pin', '1234']);
          }
        });

        sqliteDb.get('SELECT value FROM settings WHERE key = ?', ['update_interval'], (err, row) => {
          if (!row) {
            sqliteDb.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['update_interval', '5']);
          }
        });

        sqliteDb.get('SELECT COUNT(*) as count FROM vehicles', (err, row) => {
          if (row && row.count === 0) {
            console.log('Sembrando vehículos iniciales en SQLite...');
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

            const stmt = sqliteDb.prepare(`
              INSERT INTO vehicles (code, name, plate, type, driver_name, color, last_latitude, last_longitude, last_speed, last_heading, last_battery, last_seen)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            stmt.run([v1.code, v1.name, v1.plate, v1.type, v1.driver_name, v1.color, v1.last_latitude, v1.last_longitude, v1.last_speed, v1.last_heading, v1.last_battery, v1.last_seen]);
            stmt.run([v2.code, v2.name, v2.plate, v2.type, v2.driver_name, v2.color, v2.last_latitude, v2.last_longitude, v2.last_speed, v2.last_heading, v2.last_battery, v2.last_seen]);
            stmt.finalize(() => {
              resolve();
            });
          } else {
            resolve();
          }
        });
      });
    });
  }
}

// Iniciar proceso de verificación del esquema
ensureInitialized();

// Métodos de Gestión y Acceso a Datos
module.exports = {
  dbRun,
  dbAll,
  dbGet,
  generatePairCode,
  isPostgres,

  // 1. Ajustes del Sistema
  async getSettings() {
    const rows = await dbAll('SELECT key, value FROM settings');
    const settings = {};
    rows.forEach(r => settings[r.key] = r.value);
    return settings;
  },

  async updateSetting(key, value) {
    await dbRun(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
    `, [key, String(value)]);
    return { key, value };
  },

  // 2. Gestión de Vehículos
  async getAllVehicles() {
    const rows = await dbAll('SELECT * FROM vehicles WHERE is_active = 1 ORDER BY name ASC');
    const now = Date.now();

    return rows.map(v => {
      let connection_status = 'offline';
      if (v.last_seen) {
        const lastSeenDate = v.last_seen instanceof Date ? v.last_seen : new Date(v.last_seen);
        const diffSec = Math.floor((now - lastSeenDate.getTime()) / 1000);
        if (diffSec < 60) connection_status = 'online';
        else if (diffSec < 600) connection_status = 'recent';
      }

      return {
        ...v,
        last_seen: v.last_seen instanceof Date ? v.last_seen.toISOString() : v.last_seen,
        connection_status
      };
    });
  },

  async getVehicleById(id) {
    const v = await dbGet('SELECT * FROM vehicles WHERE id = ?', [id]);
    if (v && v.last_seen instanceof Date) {
      v.last_seen = v.last_seen.toISOString();
    }
    return v;
  },

  async getVehicleByCode(code) {
    if (!code) return null;
    const cleanCode = code.trim().toUpperCase();
    const v = await dbGet('SELECT * FROM vehicles WHERE UPPER(code) = ?', [cleanCode]);
    if (v && v.last_seen instanceof Date) {
      v.last_seen = v.last_seen.toISOString();
    }
    return v;
  },

  async getVehicleByToken(deviceToken) {
    if (!deviceToken) return null;
    const v = await dbGet('SELECT * FROM vehicles WHERE device_token = ?', [deviceToken]);
    if (v && v.last_seen instanceof Date) {
      v.last_seen = v.last_seen.toISOString();
    }
    return v;
  },

  async createVehicle({ name, plate, type = 'truck', driver_name = '', color = '#2563eb' }) {
    let code = generatePairCode();
    let exists = await dbGet('SELECT id FROM vehicles WHERE code = ?', [code]);
    while (exists) {
      code = generatePairCode();
      exists = await dbGet('SELECT id FROM vehicles WHERE code = ?', [code]);
    }

    const res = await dbRun(`
      INSERT INTO vehicles (code, name, plate, type, driver_name, color, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `, [code, name.trim(), plate.trim().toUpperCase(), type, driver_name.trim(), color]);

    return await this.getVehicleById(res.lastID);
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
    return await this.getVehicleById(id);
  },

  async deleteVehicle(id) {
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

    return await this.getVehicleById(vehicle.id);
  },

  async unlinkVehicle(id) {
    await dbRun(`
      UPDATE vehicles 
      SET device_token = NULL, device_info = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [id]);
    return { success: true };
  },

  // 3. Ingesta de Ubicación GPS
  async recordLocation(vehicleId, { latitude, longitude, speed = 0, heading = 0, accuracy = 0, battery_level = null, recorded_at = null }) {
    const now = recorded_at ? new Date(recorded_at) : new Date();
    const dateStr = now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const timestampIso = now.toISOString();

    // Insertar en historial de logs
    const res = await dbRun(`
      INSERT INTO gps_logs (vehicle_id, latitude, longitude, speed, heading, accuracy, battery_level, date_str, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [vehicleId, latitude, longitude, speed, heading, accuracy, battery_level, dateStr, timestampIso]);

    // Actualizar último estado del vehículo
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

  // 4. Consulta de Historial Diario con Métricas y Detección de Paradas
  async getDailyHistory(vehicleId, dateStr) {
    const vehicle = await this.getVehicleById(vehicleId);
    if (!vehicle) throw new Error('Vehículo no encontrado');

    const pointsRaw = await dbAll(`
      SELECT 
        id, latitude, longitude, speed, heading, accuracy, battery_level, recorded_at
      FROM gps_logs
      WHERE vehicle_id = ? AND date_str = ?
      ORDER BY recorded_at ASC
    `, [vehicleId, dateStr]);

    const points = pointsRaw.map(p => ({
      ...p,
      recorded_at: p.recorded_at instanceof Date ? p.recorded_at.toISOString() : p.recorded_at
    }));

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
      const speed = parseFloat(p.speed) || 0;
      if (speed > maxSpeed) maxSpeed = speed;
      if (speed > 0) {
        speedSum += speed;
        validSpeedCount++;
      }

      if (i > 0) {
        const prev = points[i - 1];
        const dist = haversine(prev.latitude, prev.longitude, p.latitude, p.longitude);
        if (dist > 0.005) { // Al menos 5 metros
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
            if (stopDuration >= 3) {
              currentStop.durationMinutes = Math.round(stopDuration);
              stops.push(currentStop);
            }
            currentStop = null;
          }
        }
      }
    }

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
