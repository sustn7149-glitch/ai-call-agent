const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "../../database.sqlite");

let db = null;

// 데이터베이스를 파일로 저장
const saveDatabase = () => {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  }
};

// 데이터베이스 초기화 (비동기)
const initDB = async () => {
  const SQL = await initSqlJs();

  // 기존 DB 파일이 있으면 로드, 없으면 새로 생성
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
    console.log("✅ Database loaded from file");
  } else {
    db = new SQL.Database();
    console.log("✅ New database created");
  }

  // 테이블 생성
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

  // AI 분석 결과 테이블 생성
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

  saveDatabase();
  console.log("✅ Database initialized");
};

// 초기화 Promise
const dbReady = initDB();

module.exports = {
  // DB 준비 완료 대기용
  ready: () => dbReady,

  saveCallEvent: (data) => {
    if (!db) throw new Error("Database not initialized");

    db.run(
      `INSERT INTO calls (phone_number, status, direction) VALUES (?, ?, ?)`,
      [data.number || 'UNKNOWN', data.status, data.direction || 'IN']
    );
    saveDatabase();

    const result = db.exec("SELECT last_insert_rowid() as id");
    return { lastInsertRowid: result[0]?.values[0]?.[0] };
  },

  updateRecording: (phoneNumber, filePath) => {
    if (!db) throw new Error("Database not initialized");

    // sql.js는 ORDER BY + LIMIT이 UPDATE에서 지원 안됨 -> 서브쿼리 사용
    db.run(
      `UPDATE calls SET recording_path = ?, status = 'COMPLETED'
       WHERE id = (SELECT id FROM calls WHERE phone_number = ? ORDER BY id DESC LIMIT 1)`,
      [filePath, phoneNumber]
    );
    saveDatabase();

    return { changes: db.getRowsModified() };
  },

  // 전체 통화 조회 (테스트용)
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
        a.transcript, a.summary, a.sentiment, a.sentiment_score,
        a.checklist, a.analyzed_at
       FROM calls c
       LEFT JOIN analysis_results a ON c.id = a.call_id
       ORDER BY c.created_at DESC`
    );

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
  },

  // AI 분석 결과 저장
  saveAnalysisResult: (callId, results) => {
    if (!db) throw new Error("Database not initialized");

    // 분석 결과 저장
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

    // 통화 기록의 ai_analyzed 플래그 업데이트
    db.run(
      `UPDATE calls SET ai_analyzed = 1 WHERE id = ?`,
      [callId]
    );

    saveDatabase();

    const result = db.exec("SELECT last_insert_rowid() as id");
    return { lastInsertRowid: result[0]?.values[0]?.[0] };
  },

  // 특정 통화의 분석 결과 조회 (통화 정보 + 분석 결과 조인)
  getCallWithAnalysis: (callId) => {
    if (!db) return null;

    const result = db.exec(
      `SELECT
        c.id, c.call_id, c.phone_number, c.direction, c.status,
        c.recording_path, c.duration, c.created_at, c.ai_analyzed,
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

    // checklist JSON 파싱
    if (row.checklist) {
      try {
        row.checklist = JSON.parse(row.checklist);
      } catch (e) {
        row.checklist = null;
      }
    }

    return row;
  },

  // 특정 통화의 분석 결과만 조회
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

    // checklist JSON 파싱
    if (row.checklist) {
      try {
        row.checklist = JSON.parse(row.checklist);
      } catch (e) {
        row.checklist = null;
      }
    }

    return row;
  },

  // AI 분석 대기 중인 통화 목록 조회
  getPendingAnalysisCalls: () => {
    if (!db) return [];

    const result = db.exec(
      `SELECT * FROM calls
       WHERE ai_analyzed = 0 AND recording_path IS NOT NULL
       ORDER BY created_at ASC`
    );

    if (!result[0]) return [];

    const columns = result[0].columns;
    return result[0].values.map(values => {
      const row = {};
      columns.forEach((col, idx) => {
        row[col] = values[idx];
      });
      return row;
    });
  }
};
