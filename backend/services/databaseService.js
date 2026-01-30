const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const dbPath = process.env.DB_PATH || path.join(__dirname, "../../database.sqlite");

let db = null;

// 전화번호 정규화: +82 → 0 형식 통일
const normalizePhone = (phone) => {
  if (!phone) return phone;
  return phone.replace(/^\+82/, '0');
};

// ffprobe로 녹음파일 실제 길이(초) 측정
const getRecordingDuration = (filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return 0;
    const output = execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { timeout: 10000 }
    ).toString().trim();
    const dur = Math.round(parseFloat(output));
    return isNaN(dur) ? 0 : dur;
  } catch {
    return 0;
  }
};

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
      raw_transcript TEXT,
      summary TEXT,
      sentiment TEXT,
      sentiment_score REAL,
      checklist TEXT,
      analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (call_id) REFERENCES calls(id)
    )
  `);

  addColumnIfNotExists('analysis_results', 'raw_transcript', 'TEXT');

  // Migration: add new columns
  addColumnIfNotExists('calls', 'uploader_name', 'TEXT');
  addColumnIfNotExists('calls', 'uploader_phone', 'TEXT');
  addColumnIfNotExists('calls', 'customer_name', 'TEXT');
  addColumnIfNotExists('calls', 'ai_emotion', 'TEXT');
  addColumnIfNotExists('calls', 'ai_score', 'REAL');
  addColumnIfNotExists('calls', 'ai_summary', 'TEXT');
  addColumnIfNotExists('calls', 'ai_status', "TEXT DEFAULT 'pending'");
  addColumnIfNotExists('calls', 'team_name', 'TEXT');
  addColumnIfNotExists('calls', 'start_time', 'TEXT');
  addColumnIfNotExists('calls', 'outcome', 'TEXT');

  // Unique index to prevent duplicate uploads
  try {
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_dedup ON calls(uploader_phone, start_time) WHERE uploader_phone IS NOT NULL AND start_time IS NOT NULL`);
    console.log("Dedup index ensured: idx_calls_dedup");
  } catch (e) {
    // Index may already exist
  }

  // ===== Teams table =====
  db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      evaluation_prompt TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      phone_number TEXT PRIMARY KEY,
      name TEXT,
      team_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: add team_id to agents
  addColumnIfNotExists('agents', 'team_id', 'INTEGER');

  // ===== 백필: calls.team_name을 agents 테이블에서 매칭 =====
  try {
    const backfillResult = db.run(
      `UPDATE calls SET team_name = (
        SELECT a.team_name FROM agents a
        WHERE a.phone_number = REPLACE(calls.uploader_phone, '+82', '0')
        AND a.team_name IS NOT NULL
      ) WHERE team_name IS NULL AND uploader_phone IS NOT NULL`
    );
    const teamBackfilled = db.getRowsModified();
    if (teamBackfilled > 0) {
      console.log(`[Migration] Backfilled team_name for ${teamBackfilled} calls`);
    }
  } catch (e) {
    console.error('[Migration] team_name backfill error:', e.message);
  }

  // ===== 백필: duration=0인데 녹음파일 있는 경우 ffprobe로 실제 길이 측정 =====
  try {
    const zeroDur = db.exec(
      `SELECT id, recording_path FROM calls
       WHERE (duration = 0 OR duration IS NULL)
       AND recording_path IS NOT NULL`
    );
    if (zeroDur[0] && zeroDur[0].values.length > 0) {
      let fixed = 0;
      for (const [id, recPath] of zeroDur[0].values) {
        const actualDur = getRecordingDuration(recPath);
        if (actualDur > 0) {
          db.run(`UPDATE calls SET duration = ? WHERE id = ?`, [actualDur, id]);
          fixed++;
        }
      }
      if (fixed > 0) {
        console.log(`[Migration] Fixed duration for ${fixed}/${zeroDur[0].values.length} calls via ffprobe`);
      }
    }
  } catch (e) {
    console.error('[Migration] duration backfill error:', e.message);
  }

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

  checkDuplicate: (uploaderPhone, startTime) => {
    if (!db || !uploaderPhone || !startTime) return false;
    const result = db.exec(
      `SELECT id FROM calls WHERE uploader_phone = ? AND start_time = ? LIMIT 1`,
      [uploaderPhone, startTime]
    );
    return result[0]?.values?.length > 0;
  },

  saveUploadRecord: (data) => {
    if (!db) throw new Error("Database not initialized");

    const {
      phoneNumber, filePath, uploaderName, uploaderPhone,
      callType, duration, contactName, teamName, startTime
    } = data;

    const direction = callType === 'OUTGOING' ? 'OUT' : 'IN';

    db.run(
      `INSERT INTO calls (phone_number, status, recording_path, direction, duration,
        uploader_name, uploader_phone, customer_name, team_name, ai_status, start_time,
        created_at)
       VALUES (?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, 'pending', ?,
        datetime('now', '+9 hours'))`,
      [
        phoneNumber || '',
        filePath,
        direction,
        parseInt(duration) || 0,
        uploaderName || null,
        uploaderPhone || null,
        contactName || null,
        teamName || null,
        startTime || null
      ]
    );
    saveDatabase();

    const result = db.exec("SELECT last_insert_rowid() as id");
    return { lastInsertRowid: result[0]?.values[0]?.[0] };
  },

  updateRecording: (data) => {
    if (!db) throw new Error("Database not initialized");

    const {
      phoneNumber, filePath, uploaderName, uploaderPhone,
      callType, duration, contactName, teamName, startTime
    } = data;

    const direction = callType === 'OUTGOING' ? 'OUT' : 'IN';

    db.run(
      `UPDATE calls SET recording_path = ?, status = 'COMPLETED',
        uploader_name = ?, uploader_phone = ?,
        direction = ?, duration = ?, customer_name = ?, team_name = ?,
        start_time = ?, ai_status = 'pending'
       WHERE id = (SELECT id FROM calls WHERE phone_number = ? ORDER BY id DESC LIMIT 1)`,
      [
        filePath,
        uploaderName || null,
        uploaderPhone || null,
        direction,
        parseInt(duration) || 0,
        contactName || null,
        teamName || null,
        startTime || null,
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
        COALESCE(c.team_name, ag.team_name) as team_name,
        c.start_time, c.outcome,
        a.transcript, a.raw_transcript, a.summary, a.sentiment, a.sentiment_score,
        a.checklist, a.analyzed_at
       FROM calls c
       LEFT JOIN analysis_results a ON c.id = a.call_id
       LEFT JOIN agents ag ON ag.phone_number = REPLACE(c.uploader_phone, '+82', '0')
       WHERE c.recording_path IS NOT NULL
       ORDER BY c.created_at DESC`
    );

    return rowsToObjects(result);
  },

  saveAnalysisResult: (callId, results) => {
    if (!db) throw new Error("Database not initialized");

    db.run(
      `INSERT INTO analysis_results (call_id, transcript, raw_transcript, summary, sentiment, sentiment_score, checklist)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        callId,
        results.transcript || '',
        results.raw_transcript || null,
        results.summary || '',
        results.sentiment || '',
        results.sentiment_score || null,
        null // checklist removed
      ]
    );

    db.run(
      `UPDATE calls SET
        ai_analyzed = 1,
        ai_emotion = ?,
        ai_score = ?,
        ai_summary = ?,
        ai_status = 'completed',
        outcome = ?
       WHERE id = ?`,
      [
        results.sentiment || '',
        results.ai_score != null ? results.ai_score : null,
        results.summary || '',
        results.outcome || null,
        callId
      ]
    );

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
        COALESCE(c.team_name, ag.team_name) as team_name,
        c.start_time, c.outcome,
        a.transcript, a.raw_transcript, a.summary, a.sentiment, a.sentiment_score,
        a.checklist, a.analyzed_at
       FROM calls c
       LEFT JOIN analysis_results a ON c.id = a.call_id
       LEFT JOIN agents ag ON ag.phone_number = REPLACE(c.uploader_phone, '+82', '0')
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

    // KST today (container runs UTC, +9h for Korea)
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = kst.toISOString().split('T')[0];

    // Use COALESCE(start_time, created_at) for date matching
    const dateExpr = `COALESCE(start_time, created_at)`;

    const totalResult = db.exec(
      `SELECT COUNT(*) FROM calls WHERE date(${dateExpr}) = date(?) AND recording_path IS NOT NULL`, [today]
    );
    const todayTotal = totalResult[0]?.values[0]?.[0] || 0;

    const avgResult = db.exec(
      `SELECT AVG(duration) FROM calls WHERE date(${dateExpr}) = date(?) AND duration > 0 AND recording_path IS NOT NULL`, [today]
    );
    const avgDuration = Math.round(avgResult[0]?.values[0]?.[0] || 0);

    const missedResult = db.exec(
      `SELECT COUNT(*) FROM calls WHERE date(${dateExpr}) = date(?) AND direction = 'IN' AND duration < 5 AND recording_path IS NOT NULL`, [today]
    );
    const missedCount = missedResult[0]?.values[0]?.[0] || 0;

    const inResult = db.exec(
      `SELECT COUNT(*) FROM calls WHERE date(${dateExpr}) = date(?) AND direction = 'IN' AND recording_path IS NOT NULL`, [today]
    );
    const incomingCount = inResult[0]?.values[0]?.[0] || 0;

    const outResult = db.exec(
      `SELECT COUNT(*) FROM calls WHERE date(${dateExpr}) = date(?) AND direction = 'OUT' AND recording_path IS NOT NULL`, [today]
    );
    const outgoingCount = outResult[0]?.values[0]?.[0] || 0;

    return { todayTotal, avgDuration, missedCount, incomingCount, outgoingCount };
  },

  getAgentStats: () => {
    if (!db) return [];

    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = kst.toISOString().split('T')[0];

    const result = db.exec(
      `SELECT
        uploader_name,
        uploader_phone,
        COUNT(*) as total_calls,
        AVG(duration) as avg_duration,
        AVG(ai_score) as avg_score,
        MAX(COALESCE(start_time, created_at)) as last_activity
       FROM calls
       WHERE date(COALESCE(start_time, created_at)) = date(?) AND uploader_name IS NOT NULL AND recording_path IS NOT NULL
       GROUP BY uploader_phone
       ORDER BY total_calls DESC`,
      [today]
    );

    return rowsToObjects(result);
  },

  // ========== Agent Daily Breakdown (for LiveMonitor) ==========
  getAgentDailyBreakdown: () => {
    if (!db) return [];

    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = kst.toISOString().split('T')[0];

    const result = db.exec(
      `SELECT
        c.uploader_name,
        c.uploader_phone,
        COALESCE(c.team_name, a.team_name) as team_name,
        COUNT(*) as total_calls,
        SUM(CASE WHEN c.direction = 'OUT' THEN 1 ELSE 0 END) as outgoing_calls,
        SUM(CASE WHEN c.direction = 'IN' AND c.duration >= 5 THEN 1 ELSE 0 END) as incoming_calls,
        SUM(CASE WHEN c.direction = 'IN' AND c.duration < 5 THEN 1 ELSE 0 END) as missed_calls,
        COALESCE(SUM(c.duration), 0) as total_duration
       FROM calls c
       LEFT JOIN agents a ON a.phone_number = REPLACE(c.uploader_phone, '+82', '0')
       WHERE date(COALESCE(c.start_time, c.created_at)) = date(?) AND c.uploader_name IS NOT NULL AND c.recording_path IS NOT NULL
       GROUP BY c.uploader_phone
       ORDER BY total_calls DESC`,
      [today]
    );

    return rowsToObjects(result);
  },

  // ========== Report Stats (for Reports page) ==========
  getReportStats: (startDate, endDate) => {
    if (!db) return [];

    const result = db.exec(
      `SELECT
        c.uploader_name,
        c.uploader_phone,
        COALESCE(c.team_name, a.team_name, '미지정') as team_name,
        COALESCE(SUM(c.duration), 0) as total_duration,
        COUNT(*) as total_calls,
        SUM(CASE WHEN c.direction = 'OUT' THEN 1 ELSE 0 END) as outgoing,
        SUM(CASE WHEN c.direction = 'IN' AND c.duration >= 5 THEN 1 ELSE 0 END) as incoming,
        SUM(CASE WHEN c.direction = 'IN' AND c.duration < 5 THEN 1 ELSE 0 END) as missed,
        ROUND(AVG(CASE WHEN c.ai_score IS NOT NULL AND c.ai_score > 0 THEN c.ai_score ELSE NULL END), 1) as avg_score
       FROM calls c
       LEFT JOIN agents a ON a.phone_number = REPLACE(c.uploader_phone, '+82', '0')
       WHERE date(COALESCE(c.start_time, c.created_at)) >= date(?) AND date(COALESCE(c.start_time, c.created_at)) <= date(?)
         AND c.uploader_name IS NOT NULL AND c.recording_path IS NOT NULL
       GROUP BY c.uploader_phone
       ORDER BY avg_score DESC`,
      [startDate, endDate]
    );

    return rowsToObjects(result);
  },

  // ========== Agents CRUD ==========
  getAllAgents: () => {
    if (!db) return [];
    const result = db.exec(
      `SELECT a.*, t.name as resolved_team_name
       FROM agents a
       LEFT JOIN teams t ON a.team_id = t.id
       ORDER BY a.created_at DESC`
    );
    return rowsToObjects(result);
  },

  upsertAgent: (data) => {
    if (!db) throw new Error("Database not initialized");
    const { phone_number, name, team_name, team_id } = data;
    db.run(
      `INSERT INTO agents (phone_number, name, team_name, team_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(phone_number) DO UPDATE SET
         name = excluded.name,
         team_name = excluded.team_name,
         team_id = excluded.team_id,
         updated_at = CURRENT_TIMESTAMP`,
      [phone_number, name || null, team_name || null, team_id != null ? team_id : null]
    );
    saveDatabase();
    return { phone_number };
  },

  // Auto-register agent from heartbeat (name only, preserves team assignment)
  ensureAgentExists: (phoneNumber, name) => {
    if (!db || !phoneNumber) return;
    db.run(
      `INSERT INTO agents (phone_number, name)
       VALUES (?, ?)
       ON CONFLICT(phone_number) DO UPDATE SET
         name = COALESCE(NULLIF(excluded.name, ''), agents.name),
         updated_at = CURRENT_TIMESTAMP`,
      [phoneNumber, name || null]
    );
    saveDatabase();
  },

  updateAgent: (phone, data) => {
    if (!db) throw new Error("Database not initialized");
    const { name, team_name, team_id } = data;
    db.run(
      `UPDATE agents SET name = ?, team_name = ?, team_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE phone_number = ?`,
      [name || null, team_name || null, team_id != null ? team_id : null, phone]
    );
    saveDatabase();
    return { changes: db.getRowsModified() };
  },

  deleteAgent: (phone) => {
    if (!db) throw new Error("Database not initialized");
    db.run("DELETE FROM agents WHERE phone_number = ?", [phone]);
    saveDatabase();
    return { changes: db.getRowsModified() };
  },

  getAgentTeam: (phone) => {
    if (!db) return null;
    // +82 → 0 정규화하여 agents 테이블과 매칭
    const normalized = normalizePhone(phone);
    const result = db.exec(
      `SELECT team_name FROM agents WHERE phone_number = ? OR phone_number = ?`,
      [phone, normalized]
    );
    if (!result[0] || !result[0].values.length) return null;
    return result[0].values[0][0];
  },

  // ========== Teams CRUD ==========
  getAllTeams: () => {
    if (!db) return [];
    const result = db.exec("SELECT * FROM teams ORDER BY created_at DESC");
    return rowsToObjects(result);
  },

  createTeam: (data) => {
    if (!db) throw new Error("Database not initialized");
    const { name, evaluation_prompt } = data;
    db.run(
      `INSERT INTO teams (name, evaluation_prompt) VALUES (?, ?)`,
      [name, evaluation_prompt || null]
    );
    saveDatabase();
    const result = db.exec("SELECT last_insert_rowid() as id");
    return { id: result[0]?.values[0]?.[0] };
  },

  updateTeam: (id, data) => {
    if (!db) throw new Error("Database not initialized");
    const { name, evaluation_prompt } = data;
    db.run(
      `UPDATE teams SET name = ?, evaluation_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [name, evaluation_prompt || null, id]
    );
    saveDatabase();
    return { changes: db.getRowsModified() };
  },

  deleteTeam: (id) => {
    if (!db) throw new Error("Database not initialized");
    db.run(`UPDATE agents SET team_id = NULL, team_name = NULL WHERE team_id = ?`, [id]);
    db.run(`DELETE FROM teams WHERE id = ?`, [id]);
    saveDatabase();
    return { changes: db.getRowsModified() };
  },

  getTeamById: (id) => {
    if (!db) return null;
    const result = db.exec(`SELECT * FROM teams WHERE id = ?`, [id]);
    if (!result[0] || !result[0].values.length) return null;
    const columns = result[0].columns;
    const values = result[0].values[0];
    const row = {};
    columns.forEach((col, idx) => { row[col] = values[idx]; });
    return row;
  },

  getTeamEvaluationPrompt: (teamId) => {
    if (!db || !teamId) return null;
    const result = db.exec(`SELECT evaluation_prompt FROM teams WHERE id = ?`, [teamId]);
    if (!result[0] || !result[0].values.length) return null;
    return result[0].values[0][0];
  },

  getAgentTeamId: (phone) => {
    if (!db) return null;
    const normalized = normalizePhone(phone);
    const result = db.exec(
      `SELECT team_id FROM agents WHERE phone_number = ? OR phone_number = ?`,
      [phone, normalized]
    );
    if (!result[0] || !result[0].values.length) return null;
    return result[0].values[0][0];
  },

  // ========== Analytics ==========
  getDailyAnalytics: () => {
    if (!db) return [];
    const result = db.exec(
      `SELECT date(created_at) as date, COUNT(*) as count
       FROM calls
       WHERE created_at >= date('now', '-6 days') AND recording_path IS NOT NULL
       GROUP BY date(created_at)
       ORDER BY date ASC`
    );
    return rowsToObjects(result);
  },

  getTeamAnalytics: () => {
    if (!db) return [];
    const result = db.exec(
      `SELECT COALESCE(c.team_name, a.team_name, '미지정') as team, COUNT(*) as count
       FROM calls c
       LEFT JOIN agents a ON a.phone_number = REPLACE(c.uploader_phone, '+82', '0')
       WHERE c.recording_path IS NOT NULL
       GROUP BY team
       ORDER BY count DESC`
    );
    return rowsToObjects(result);
  },

  getDirectionAnalytics: () => {
    if (!db) return [];
    const result = db.exec(
      `SELECT direction, COUNT(*) as count
       FROM calls
       WHERE recording_path IS NOT NULL AND direction IS NOT NULL AND direction != ''
       GROUP BY direction
       ORDER BY direction ASC`
    );
    return rowsToObjects(result);
  },

  // ffprobe로 녹음파일 실제 길이 측정 (외부에서 사용 가능)
  getRecordingDuration: (filePath) => getRecordingDuration(filePath),

  // Cleanup: remove rows without recordings (junk from old webhook inserts)
  cleanupJunkRows: () => {
    if (!db) return { deleted: 0 };
    db.run(`DELETE FROM calls WHERE recording_path IS NULL`);
    const deleted = db.getRowsModified();
    if (deleted > 0) {
      saveDatabase();
      console.log(`[DB Cleanup] Deleted ${deleted} junk rows (no recording)`);
    }
    return { deleted };
  }
};
