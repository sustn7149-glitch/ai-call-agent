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
      raw_transcript TEXT,
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
  addColumnIfNotExists('calls', 'team_name', 'TEXT');
  addColumnIfNotExists('calls', 'start_time', 'TEXT');
  addColumnIfNotExists('analysis_results', 'raw_transcript', 'TEXT');

  // Unique index to prevent duplicate uploads (same uploader + same call start time)
  try {
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_dedup ON calls(uploader_phone, start_time) WHERE uploader_phone IS NOT NULL AND start_time IS NOT NULL`);
    console.log("Dedup index ensured: idx_calls_dedup");
  } catch (e) {
    // Index may already exist
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      phone_number TEXT PRIMARY KEY,
      name TEXT,
      team_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Teams table: name, description, evaluation_prompt
  db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      evaluation_prompt TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: seed teams from existing agent team_name values
  try {
    const existingTeams = db.exec(`SELECT DISTINCT team_name FROM agents WHERE team_name IS NOT NULL AND team_name != ''`);
    if (existingTeams[0]) {
      for (const row of existingTeams[0].values) {
        const teamName = row[0];
        try {
          db.run(
            `INSERT OR IGNORE INTO teams (name) VALUES (?)`,
            [teamName]
          );
        } catch (e) { /* already exists */ }
      }
    }
    // Also seed from calls table team_name
    const callTeams = db.exec(`SELECT DISTINCT team_name FROM calls WHERE team_name IS NOT NULL AND team_name != ''`);
    if (callTeams[0]) {
      for (const row of callTeams[0].values) {
        const teamName = row[0];
        try {
          db.run(
            `INSERT OR IGNORE INTO teams (name) VALUES (?)`,
            [teamName]
          );
        } catch (e) { /* already exists */ }
      }
    }
  } catch (e) {
    console.log("Team migration note:", e.message);
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

  // Check if a duplicate record exists (same uploader_phone + start_time)
  checkDuplicate: (uploaderPhone, startTime) => {
    if (!db || !uploaderPhone || !startTime) return false;
    const result = db.exec(
      `SELECT id FROM calls WHERE uploader_phone = ? AND start_time = ? LIMIT 1`,
      [uploaderPhone, startTime]
    );
    return result[0]?.values?.length > 0;
  },

  // Save upload with full metadata from Android app
  saveUploadRecord: (data) => {
    if (!db) throw new Error("Database not initialized");

    const {
      phoneNumber, filePath, uploaderName, uploaderPhone,
      callType, duration, contactName, teamName, startTime
    } = data;

    // Map callType to direction
    const direction = callType === 'OUTGOING' ? 'OUT' : 'IN';

    db.run(
      `INSERT INTO calls (phone_number, status, recording_path, direction, duration,
        uploader_name, uploader_phone, customer_name, team_name, ai_status, start_time)
       VALUES (?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
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

  // Update existing call record with recording + metadata
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
        c.team_name, c.start_time,
        a.transcript, a.raw_transcript, a.summary, a.sentiment, a.sentiment_score,
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
      `INSERT INTO analysis_results (call_id, transcript, raw_transcript, summary, sentiment, sentiment_score, checklist)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        callId,
        results.transcript || '',
        results.raw_transcript || null,
        results.summary || '',
        results.sentiment || '',
        results.sentiment_score ?? null,
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
        results.ai_score ?? null,
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
        c.team_name, c.start_time,
        a.transcript, a.raw_transcript, a.summary, a.sentiment, a.sentiment_score,
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
  },

  // ========== Agents CRUD ==========
  getAllAgents: () => {
    if (!db) return [];
    const result = db.exec("SELECT * FROM agents ORDER BY created_at DESC");
    return rowsToObjects(result);
  },

  upsertAgent: (data) => {
    if (!db) throw new Error("Database not initialized");
    const { phone_number, name, team_name } = data;
    db.run(
      `INSERT INTO agents (phone_number, name, team_name)
       VALUES (?, ?, ?)
       ON CONFLICT(phone_number) DO UPDATE SET
         name = excluded.name,
         team_name = excluded.team_name,
         updated_at = CURRENT_TIMESTAMP`,
      [phone_number, name || null, team_name || null]
    );
    saveDatabase();
    return { phone_number };
  },

  updateAgent: (phone, data) => {
    if (!db) throw new Error("Database not initialized");
    const { name, team_name } = data;
    db.run(
      `UPDATE agents SET name = ?, team_name = ?, updated_at = CURRENT_TIMESTAMP
       WHERE phone_number = ?`,
      [name || null, team_name || null, phone]
    );
    saveDatabase();
    return { changes: db.getRowsModified() };
  },

  // Get team name for a call (from calls table or agents table fallback)
  getCallTeam: (callId) => {
    if (!db) return null;
    const result = db.exec(
      `SELECT COALESCE(c.team_name, a.team_name) as team_name
       FROM calls c
       LEFT JOIN agents a ON c.uploader_phone = a.phone_number
       WHERE c.id = ?`,
      [callId]
    );
    if (!result[0] || !result[0].values.length) return null;
    return result[0].values[0][0];
  },

  getAgentTeam: (phone) => {
    if (!db) return null;
    const result = db.exec(
      `SELECT team_name FROM agents WHERE phone_number = ?`,
      [phone]
    );
    if (!result[0] || !result[0].values.length) return null;
    return result[0].values[0][0];
  },

  // ========== Teams CRUD ==========
  getAllTeams: () => {
    if (!db) return [];
    const result = db.exec("SELECT * FROM teams ORDER BY name ASC");
    return rowsToObjects(result);
  },

  getTeamByName: (name) => {
    if (!db) return null;
    const result = db.exec("SELECT * FROM teams WHERE name = ?", [name]);
    if (!result[0] || !result[0].values.length) return null;
    const columns = result[0].columns;
    const values = result[0].values[0];
    const row = {};
    columns.forEach((col, idx) => { row[col] = values[idx]; });
    return row;
  },

  createTeam: (data) => {
    if (!db) throw new Error("Database not initialized");
    const { name, description, evaluation_prompt } = data;
    if (!name || !name.trim()) throw new Error("Team name is required");
    db.run(
      `INSERT INTO teams (name, description, evaluation_prompt) VALUES (?, ?, ?)`,
      [name.trim(), description || '', evaluation_prompt || '']
    );
    const result = db.exec("SELECT last_insert_rowid() as id");
    const id = result[0]?.values[0]?.[0] || 0;
    saveDatabase();
    return { id };
  },

  updateTeam: (id, data) => {
    if (!db) throw new Error("Database not initialized");
    const { name, description, evaluation_prompt } = data;
    if (name !== undefined && !name.trim()) throw new Error("팀 이름은 비워둘 수 없습니다");

    db.run("BEGIN TRANSACTION");
    try {
      // Get old name for cascading update
      const oldResult = db.exec("SELECT name FROM teams WHERE id = ?", [id]);
      const oldName = oldResult[0]?.values?.[0]?.[0];

      db.run(
        `UPDATE teams SET name = ?, description = ?, evaluation_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [name?.trim() || oldName, description ?? '', evaluation_prompt ?? '', id]
      );
      const changes = db.getRowsModified();

      // Cascade team name update to agents and calls tables
      if (changes > 0 && oldName && name && name.trim() !== oldName) {
        db.run(`UPDATE agents SET team_name = ? WHERE team_name = ?`, [name.trim(), oldName]);
        db.run(`UPDATE calls SET team_name = ? WHERE team_name = ?`, [name.trim(), oldName]);
      }

      db.run("COMMIT");
      saveDatabase();
      return { changes };
    } catch (e) {
      try { db.run("ROLLBACK"); } catch (_) { }
      throw e;
    }
  },

  deleteTeam: (id) => {
    if (!db) throw new Error("Database not initialized");

    db.run("BEGIN TRANSACTION");
    try {
      const teamResult = db.exec("SELECT name FROM teams WHERE id = ?", [id]);
      if (!teamResult[0]?.values?.length) {
        db.run("ROLLBACK");
        return { changes: 0 };
      }
      const teamName = teamResult[0].values[0][0];

      const agentCount = db.exec(
        "SELECT COUNT(*) FROM agents WHERE team_name = ?", [teamName]
      );
      const count = agentCount[0]?.values?.[0]?.[0] || 0;
      if (count > 0) {
        db.run("ROLLBACK");
        throw new Error(`팀에 ${count}명의 직원이 배정되어 있어 삭제할 수 없습니다. 먼저 직원의 팀을 변경해주세요.`);
      }

      db.run("DELETE FROM teams WHERE id = ?", [id]);
      const changes = db.getRowsModified();
      db.run("COMMIT");
      saveDatabase();
      return { changes };
    } catch (e) {
      try { db.run("ROLLBACK"); } catch (_) { }
      throw e;
    }
  },

  // Get evaluation prompt for a team name
  getTeamEvaluationPrompt: (teamName) => {
    if (!db || !teamName) return null;
    const result = db.exec(
      "SELECT evaluation_prompt FROM teams WHERE name = ?",
      [teamName]
    );
    if (!result[0]?.values?.length) return null;
    const prompt = result[0].values[0][0];
    return (prompt && prompt.trim()) ? prompt : null;
  },

  // ========== Analytics ==========
  getDailyAnalytics: () => {
    if (!db) return [];
    const result = db.exec(
      `SELECT date(created_at) as date, COUNT(*) as count
       FROM calls
       WHERE created_at >= date('now', '-6 days')
       GROUP BY date(created_at)
       ORDER BY date ASC`
    );
    return rowsToObjects(result);
  },

  getTeamAnalytics: () => {
    if (!db) return [];
    const result = db.exec(
      `SELECT COALESCE(team_name, '미지정') as team, COUNT(*) as count
       FROM calls
       GROUP BY team_name
       ORDER BY count DESC`
    );
    return rowsToObjects(result);
  },

  // Per-agent daily stats map (keyed by uploader_phone)
  getAgentDailyStatsMap: () => {
    if (!db) return {};
    const today = new Date().toISOString().split('T')[0];
    const result = db.exec(
      `SELECT
        uploader_phone,
        COUNT(*) as total_calls,
        SUM(CASE WHEN direction = 'OUT' THEN 1 ELSE 0 END) as outgoing,
        SUM(CASE WHEN direction = 'IN' THEN 1 ELSE 0 END) as incoming,
        SUM(CASE WHEN direction = 'IN' AND (duration = 0 OR duration IS NULL) THEN 1 ELSE 0 END) as missed,
        COALESCE(SUM(duration), 0) as total_duration,
        MAX(created_at) as last_call_at
       FROM calls
       WHERE date(created_at) = date(?) AND uploader_phone IS NOT NULL
       GROUP BY uploader_phone`,
      [today]
    );

    const statsMap = {};
    if (result[0]) {
      const cols = result[0].columns;
      result[0].values.forEach(row => {
        const obj = {};
        cols.forEach((col, idx) => { obj[col] = row[idx]; });
        statsMap[obj.uploader_phone] = obj;
      });
    }
    return statsMap;
  },

  getDirectionAnalytics: () => {
    if (!db) return [];
    const result = db.exec(
      `SELECT direction, COUNT(*) as count
       FROM calls
       GROUP BY direction`
    );
    return rowsToObjects(result);
  },

  // ========== Reports: period-based stats ==========
  getReportStats: (startDate, endDate, teamFilter) => {
    if (!db) return { agents: [], teams: [], globalStats: {} };

    const teamClause = teamFilter
      ? `AND COALESCE(a.team_name, c.team_name, '미지정') = ?`
      : '';
    const params = teamFilter
      ? [startDate, endDate, teamFilter]
      : [startDate, endDate];

    // Per-agent stats
    const agentResult = db.exec(
      `SELECT
        c.uploader_phone,
        MAX(c.uploader_name) as uploader_name,
        COALESCE(MAX(a.team_name), MAX(c.team_name), '미지정') as team_name,
        COUNT(*) as total_calls,
        SUM(CASE WHEN c.direction = 'OUT' THEN 1 ELSE 0 END) as outgoing,
        SUM(CASE WHEN c.direction = 'IN' THEN 1 ELSE 0 END) as incoming,
        SUM(CASE WHEN c.direction = 'IN' AND (c.duration = 0 OR c.duration IS NULL) THEN 1 ELSE 0 END) as missed,
        COALESCE(SUM(c.duration), 0) as total_duration,
        ROUND(AVG(CASE WHEN c.ai_score IS NOT NULL THEN c.ai_score END), 1) as avg_score
       FROM calls c
       LEFT JOIN agents a ON c.uploader_phone = a.phone_number
       WHERE date(c.created_at) BETWEEN date(?) AND date(?)
         AND c.uploader_phone IS NOT NULL
         ${teamClause}
       GROUP BY c.uploader_phone
       ORDER BY avg_score DESC, total_calls DESC`,
      params
    );
    const agents = rowsToObjects(agentResult);

    // Team summary stats
    const teamResult = db.exec(
      `SELECT
        COALESCE(a.team_name, c.team_name, '미지정') as team_name,
        COUNT(*) as total_calls,
        SUM(CASE WHEN c.direction = 'OUT' THEN 1 ELSE 0 END) as outgoing,
        SUM(CASE WHEN c.direction = 'IN' THEN 1 ELSE 0 END) as incoming,
        SUM(CASE WHEN c.direction = 'IN' AND (c.duration = 0 OR c.duration IS NULL) THEN 1 ELSE 0 END) as missed,
        COALESCE(SUM(c.duration), 0) as total_duration,
        ROUND(AVG(CASE WHEN c.ai_score IS NOT NULL THEN c.ai_score END), 1) as avg_score,
        COUNT(DISTINCT c.uploader_phone) as agent_count
       FROM calls c
       LEFT JOIN agents a ON c.uploader_phone = a.phone_number
       WHERE date(c.created_at) BETWEEN date(?) AND date(?)
         AND c.uploader_phone IS NOT NULL
         ${teamClause}
       GROUP BY COALESCE(a.team_name, c.team_name, '미지정')
       ORDER BY total_calls DESC`,
      params
    );
    const teams = rowsToObjects(teamResult);

    // Global stats
    const globalResult = db.exec(
      `SELECT
        COUNT(*) as total_calls,
        SUM(CASE WHEN c.direction = 'OUT' THEN 1 ELSE 0 END) as outgoing,
        SUM(CASE WHEN c.direction = 'IN' THEN 1 ELSE 0 END) as incoming,
        SUM(CASE WHEN c.direction = 'IN' AND (c.duration = 0 OR c.duration IS NULL) THEN 1 ELSE 0 END) as missed,
        COALESCE(SUM(c.duration), 0) as total_duration,
        ROUND(AVG(CASE WHEN c.ai_score IS NOT NULL THEN c.ai_score END), 1) as avg_score,
        COUNT(DISTINCT c.uploader_phone) as agent_count
       FROM calls c
       LEFT JOIN agents a ON c.uploader_phone = a.phone_number
       WHERE date(c.created_at) BETWEEN date(?) AND date(?)
         AND c.uploader_phone IS NOT NULL
         ${teamClause}`,
      params
    );
    const globalStats = rowsToObjects(globalResult)[0] || {
      total_calls: 0, outgoing: 0, incoming: 0, missed: 0,
      total_duration: 0, avg_score: null, agent_count: 0
    };

    return { agents, teams, globalStats };
  }
};
