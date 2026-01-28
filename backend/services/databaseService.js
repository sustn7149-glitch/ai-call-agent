const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "../../database.sqlite");

let db = null;

const saveDatabase = () => {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
};

const addColumnIfNotExists = (table, column, type) => {
  try {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    console.log(`Column added: ${table}.${column}`);
  } catch (e) {
    // Column already exists - ignore
  }
};

const initDB = async () => {
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
    console.log("Database loaded from file");
  } else {
    db = new SQL.Database();
    console.log("New database created");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id TEXT UNIQUE,
      phone_number TEXT,
      direction TEXT,
      status TEXT,
      recording_path TEXT,
      duration INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ai_analyzed BOOLEAN DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS analysis_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      call_id INTEGER,
      transcript TEXT,
      summary TEXT,
      sentiment TEXT,
      sentiment_score REAL,
      checklist TEXT,
      analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (call_id) REFERENCES calls(id)
    )
  `);

  // Migration: add new columns
  addColumnIfNotExists('calls', 'uploader_name', 'TEXT');
  addColumnIfNotExists('calls', 'uploader_phone', 'TEXT');
  addColumnIfNotExists('calls', 'customer_name', 'TEXT');
  addColumnIfNotExists('calls', 'ai_emotion', 'TEXT');
  addColumnIfNotExists('calls', 'ai_score', 'REAL');
  addColumnIfNotExists('calls', 'ai_summary', 'TEXT');
  addColumnIfNotExists('calls', 'ai_status', "TEXT DEFAULT 'pending'");

  saveDatabase();
  console.log("Database initialized");
};

const dbReady = initDB();

// Helper: convert row arrays to objects
const rowsToObjects = (result) => {
  if (!result[0]) return [];
  const columns = result[0].columns;
  return result[0].values.map(values => {
    const row = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx];
    });
    if (row.checklist) {
      try { row.checklist = JSON.parse(row.checklist); } catch (e) { row.checklist = null; }
    }
    return row;
  });
};

module.exports = {
  ready: () => dbReady,

  saveCallEvent: (data) => {
    if (!db) throw new Error("Database not initialized");

    db.run(
      `INSERT INTO calls (phone_number, status, direction) VALUES (?, ?, ?)`,
      [data.number || '', data.status, data.direction || 'IN']
    );
    saveDatabase();

    const result = db.exec("SELECT last_insert_rowid() as id");
    return { lastInsertRowid: result[0]?.values[0]?.[0] };
  },

  // Save upload with full metadata from Android app
  saveUploadRecord: (data) => {
    if (!db) throw new Error("Database not initialized");

    const {
      phoneNumber, filePath, uploaderName, uploaderPhone,
      callType, duration, contactName
    } = data;

    // Map callType to direction
    const direction = callType === 'OUTGOING' ? 'OUT' : 'IN';

    db.run(
      `INSERT INTO calls (phone_number, status, recording_path, direction, duration,
        uploader_name, uploader_phone, customer_name, ai_status)
       VALUES (?, 'COMPLETED', ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        phoneNumber || '',
        filePath,
        direction,
        parseInt(duration) || 0,
        uploaderName || null,
        uploaderPhone || null,
        contactName || null
      ]
    );
    saveDatabase();

    const result = db.exec("SELECT last_insert_rowid() as id");
    return { lastInsertRowid: result[0]?.values[0]?.[0] };
  },

  // Update existing call record with recording + metadata
  updateRecording: (data) => {
    if (!db) throw new Error("Database not initialized");

    const {
      phoneNumber, filePath, uploaderName, uploaderPhone,
      callType, duration, contactName
    } = data;

    const direction = callType === 'OUTGOING' ? 'OUT' : 'IN';

    db.run(
      `UPDATE calls SET recording_path = ?, status = 'COMPLETED',
        uploader_name = ?, uploader_phone = ?,
        direction = ?, duration = ?, customer_name = ?, ai_status = 'pending'
       WHERE id = (SELECT id FROM calls WHERE phone_number = ? ORDER BY id DESC LIMIT 1)`,
      [
        filePath,
        uploaderName || null,
        uploaderPhone || null,
        direction,
        parseInt(duration) || 0,
        contactName || null,
        phoneNumber
      ]
    );
    saveDatabase();

    return { changes: db.getRowsModified() };
  },

  getAllCalls: () => {
    if (!db) return [];
    const result = db.exec("SELECT * FROM calls ORDER BY id DESC");
    return result[0]?.values || [];
  },

  getAllCallsWithAnalysis: () => {
    if (!db) return [];
    const result = db.exec(
      `SELECT
        c.id, c.call_id, c.phone_number, c.direction, c.status,
        c.recording_path, c.duration, c.created_at, c.ai_analyzed,
        c.uploader_name, c.uploader_phone,
        c.customer_name, c.ai_emotion, c.ai_score, c.ai_summary, c.ai_status,
        a.transcript, a.summary, a.sentiment, a.sentiment_score,
        a.checklist, a.analyzed_at
       FROM calls c
       LEFT JOIN analysis_results a ON c.id = a.call_id
       ORDER BY c.created_at DESC`
    );

    return rowsToObjects(result);
  },

  // Save AI analysis results + update calls table
  saveAnalysisResult: (callId, results) => {
    if (!db) throw new Error("Database not initialized");

    // Save to analysis_results table
    db.run(
      `INSERT INTO analysis_results (call_id, transcript, summary, sentiment, sentiment_score, checklist)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        callId,
        results.transcript || '',
        results.summary || '',
        results.sentiment || '',
        results.sentiment_score || null,
        results.checklist ? JSON.stringify(results.checklist) : null
      ]
    );

    // Update calls table with AI results
    db.run(
      `UPDATE calls SET
        ai_analyzed = 1,
        ai_emotion = ?,
        ai_score = ?,
        ai_summary = ?,
        ai_status = 'completed'
       WHERE id = ?`,
      [
        results.sentiment || '',
        results.ai_score || null,
        results.summary || '',
        callId
      ]
    );

    // Update customer_name from AI extraction only if not already set
    if (results.customer_name) {
      db.run(
        `UPDATE calls SET customer_name = ?
         WHERE id = ? AND (customer_name IS NULL OR customer_name = '')`,
        [results.customer_name, callId]
      );
    }

    saveDatabase();

    const result = db.exec("SELECT last_insert_rowid() as id");
    return { lastInsertRowid: result[0]?.values[0]?.[0] };
  },

  // Update ai_status for a call (e.g. 'processing', 'failed')
  updateAiStatus: (callId, status) => {
    if (!db) return;
    db.run(`UPDATE calls SET ai_status = ? WHERE id = ?`, [status, callId]);
    saveDatabase();
  },

  getCallWithAnalysis: (callId) => {
    if (!db) return null;

    const result = db.exec(
      `SELECT
        c.id, c.call_id, c.phone_number, c.direction, c.status,
        c.recording_path, c.duration, c.created_at, c.ai_analyzed,
        c.uploader_name, c.uploader_phone,
        c.customer_name, c.ai_emotion, c.ai_score, c.ai_summary, c.ai_status,
        a.transcript, a.summary, a.sentiment, a.sentiment_score,
        a.checklist, a.analyzed_at
       FROM calls c
       LEFT JOIN analysis_results a ON c.id = a.call_id
       WHERE c.id = ?`,
      [callId]
    );

    if (!result[0] || !result[0].values.length) return null;

    const columns = result[0].columns;
    const values = result[0].values[0];
    const row = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx];
    });

    if (row.checklist) {
      try { row.checklist = JSON.parse(row.checklist); } catch (e) { row.checklist = null; }
    }

    return row;
  },

  getAnalysisByCallId: (callId) => {
    if (!db) return null;

    const result = db.exec(
      `SELECT * FROM analysis_results WHERE call_id = ? ORDER BY analyzed_at DESC LIMIT 1`,
      [callId]
    );

    if (!result[0] || !result[0].values.length) return null;

    const columns = result[0].columns;
    const values = result[0].values[0];
    const row = {};
    columns.forEach((col, idx) => {
      row[col] = values[idx];
    });

    if (row.checklist) {
      try { row.checklist = JSON.parse(row.checklist); } catch (e) { row.checklist = null; }
    }

    return row;
  },

  getPendingAnalysisCalls: () => {
    if (!db) return [];

    const result = db.exec(
      `SELECT * FROM calls
       WHERE ai_analyzed = 0 AND recording_path IS NOT NULL
       ORDER BY created_at ASC`
    );

    return rowsToObjects(result);
  },

  // Dashboard statistics
  getTodayStats: () => {
    if (!db) return { todayTotal: 0, avgDuration: 0, missedCount: 0, incomingCount: 0, outgoingCount: 0 };

    const today = new Date().toISOString().split('T')[0];

    const totalResult = db.exec(
      `SELECT COUNT(*) FROM calls WHERE date(created_at) = date(?)`, [today]
    );
    const todayTotal = totalResult[0]?.values[0]?.[0] || 0;

    const avgResult = db.exec(
      `SELECT AVG(duration) FROM calls WHERE date(created_at) = date(?) AND duration > 0`, [today]
    );
    const avgDuration = Math.round(avgResult[0]?.values[0]?.[0] || 0);

    const missedResult = db.exec(
      `SELECT COUNT(*) FROM calls WHERE date(created_at) = date(?) AND direction = 'IN' AND (duration = 0 OR duration IS NULL)`, [today]
    );
    const missedCount = missedResult[0]?.values[0]?.[0] || 0;

    const inResult = db.exec(
      `SELECT COUNT(*) FROM calls WHERE date(created_at) = date(?) AND direction = 'IN'`, [today]
    );
    const incomingCount = inResult[0]?.values[0]?.[0] || 0;

    const outResult = db.exec(
      `SELECT COUNT(*) FROM calls WHERE date(created_at) = date(?) AND direction = 'OUT'`, [today]
    );
    const outgoingCount = outResult[0]?.values[0]?.[0] || 0;

    return { todayTotal, avgDuration, missedCount, incomingCount, outgoingCount };
  },

  // Agent (uploader) stats for today
  getAgentStats: () => {
    if (!db) return [];

    const today = new Date().toISOString().split('T')[0];

    const result = db.exec(
      `SELECT
        uploader_name,
        uploader_phone,
        COUNT(*) as total_calls,
        AVG(duration) as avg_duration,
        AVG(ai_score) as avg_score,
        MAX(created_at) as last_activity
       FROM calls
       WHERE date(created_at) = date(?) AND uploader_name IS NOT NULL
       GROUP BY uploader_phone
       ORDER BY total_calls DESC`,
      [today]
    );

    return rowsToObjects(result);
  }
};
