/**
 * cleanup-duplicates.js
 *
 * 중복 및 UNKNOWN 데이터를 정리하는 일회성 스크립트.
 *
 * 사용법 (서버 SSH에서):
 *   docker compose stop backend
 *   docker compose run --rm --no-deps backend node scripts/cleanup-duplicates.js
 *   docker compose start backend
 */
const initSqlJs = require("sql.js");
const fs = require("fs");

const DB_PATH = process.env.DB_PATH || "/data/db/database.sqlite";

async function cleanup() {
  console.log("=== DB Cleanup Start ===\n");
  console.log(`DB path: ${DB_PATH}`);

  if (!fs.existsSync(DB_PATH)) {
    console.error("Database file not found:", DB_PATH);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(fileBuffer);

  // 1. 현재 상태 확인
  const totalBefore = db.exec("SELECT COUNT(*) FROM calls")[0].values[0][0];
  console.log(`현재 총 레코드: ${totalBefore}건\n`);

  // 상세 현황
  const unknownCount = db.exec("SELECT COUNT(*) FROM calls WHERE phone_number IN ('UNKNOWN','TEST-000-0000')")[0].values[0][0];
  console.log(`UNKNOWN/TEST 레코드: ${unknownCount}건`);

  const dupPreview = db.exec(`
    SELECT uploader_phone, created_at, COUNT(*) as cnt
    FROM calls
    WHERE uploader_phone IS NOT NULL
    GROUP BY uploader_phone, strftime('%Y-%m-%d %H:%M', created_at)
    HAVING cnt > 1
  `);
  const dupGroupCount = dupPreview[0]?.values?.length || 0;
  console.log(`중복 그룹 (분 단위): ${dupGroupCount}개\n`);

  // 2. UNKNOWN / TEST 레코드 삭제
  db.run("DELETE FROM calls WHERE phone_number IN ('UNKNOWN', 'TEST-000-0000')");
  const unknownDeleted = db.getRowsModified();
  console.log(`[1] UNKNOWN/TEST 삭제: ${unknownDeleted}건`);

  // 3. start_time 기준 중복 제거 (정확한 매칭)
  db.run(`
    DELETE FROM calls WHERE id NOT IN (
      SELECT MIN(id) FROM calls
      WHERE uploader_phone IS NOT NULL AND start_time IS NOT NULL
      GROUP BY uploader_phone, start_time
    )
    AND uploader_phone IS NOT NULL AND start_time IS NOT NULL
  `);
  const startTimeDups = db.getRowsModified();
  console.log(`[2] start_time 중복 삭제: ${startTimeDups}건`);

  // 4. start_time 없는 레코드: created_at 분 단위로 그룹화하여 중복 제거
  db.run(`
    DELETE FROM calls WHERE id NOT IN (
      SELECT MIN(id) FROM calls
      WHERE uploader_phone IS NOT NULL AND (start_time IS NULL OR start_time = '')
      GROUP BY uploader_phone, strftime('%Y-%m-%d %H:%M', created_at)
    )
    AND uploader_phone IS NOT NULL AND (start_time IS NULL OR start_time = '')
  `);
  const createdAtDups = db.getRowsModified();
  console.log(`[3] created_at 분단위 중복 삭제: ${createdAtDups}건`);

  // 5. 고아 analysis_results 정리
  db.run("DELETE FROM analysis_results WHERE call_id NOT IN (SELECT id FROM calls)");
  const orphanedAnalysis = db.getRowsModified();
  console.log(`[4] 고아 분석결과 삭제: ${orphanedAnalysis}건`);

  // 6. 결과
  const totalAfter = db.exec("SELECT COUNT(*) FROM calls")[0].values[0][0];
  const analysisCount = db.exec("SELECT COUNT(*) FROM analysis_results")[0].values[0][0];

  console.log(`\n=== 결과 ===`);
  console.log(`정리 전: ${totalBefore}건`);
  console.log(`정리 후: ${totalAfter}건`);
  console.log(`총 삭제: ${totalBefore - totalAfter}건`);
  console.log(`분석결과: ${analysisCount}건`);

  // 저장
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
  console.log(`\nDB 저장 완료: ${DB_PATH}`);

  db.close();
  console.log("=== DB Cleanup Done ===");
}

cleanup().catch(err => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
