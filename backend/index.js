const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const Redis = require('ioredis');

const queueService = require('./services/queueService');
const upload = require('./services/uploadService');
const db = require('./services/databaseService');
const analysisWorker = require('./workers/analysisWorker');

const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Redis (Heartbeat 상태 저장용)
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: 3,
});

app.use(cors());
app.use(express.json());
app.use('/recordings', express.static(process.env.RECORDINGS_PATH || path.join(__dirname, '../recordings')));

// 대시보드 정적 파일 서빙
const dashboardPath = process.env.DASHBOARD_PATH || path.join(__dirname, 'public');
app.use(express.static(dashboardPath));

// Webhook: 통화 상태 수신
app.post('/api/webhook/call', (req, res) => {
  console.log('📞 Call Event:', req.body);
  try {
    db.saveCallEvent(req.body);
    io.emit('call-status', req.body);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Upload: 녹취 파일 수신 및 큐 등록
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const file = req.file;
    const { phoneNumber, userName, userPhone } = req.body;
    console.log(`📂 Uploaded: ${file.filename} (by ${userName || 'UNKNOWN'} / ${userPhone || 'N/A'})`);

    // DB에 녹음 파일 + 업로더 정보 저장
    const result = db.updateRecording(phoneNumber, file.path, userName, userPhone);
    if (result.changes === 0) {
      // 매칭되는 통화 기록 없음 → 새 레코드 생성
      db.saveUploadRecord(phoneNumber, file.path, userName, userPhone);
    }

    await queueService.addAnalysisJob({
      filePath: file.path,
      fileName: file.filename,
      phoneNumber: phoneNumber || 'UNKNOWN'
    });

    res.json({ success: true, filename: file.filename });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Heartbeat: 앱 생존 신고
app.post('/api/heartbeat', async (req, res) => {
  const { userName, userPhone } = req.body;
  console.log(`[Heartbeat] ${userName} (${userPhone}) is online`);

  try {
    // Redis에 온라인 상태 저장 (2시간 TTL - heartbeat 간격 1시간의 2배)
    const key = `online_status:${userPhone}`;
    const value = JSON.stringify({
      userName,
      userPhone,
      lastSeen: new Date().toISOString()
    });
    await redis.set(key, value, 'EX', 7200);
  } catch (err) {
    console.error('[Heartbeat] Redis error:', err.message);
  }

  res.json({ success: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Dashboard API endpoints
app.get('/api/calls', (req, res) => {
  try {
    const result = db.getAllCallsWithAnalysis();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/calls/:id', (req, res) => {
  try {
    const result = db.getCallWithAnalysis(parseInt(req.params.id));
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 온라인 직원 목록 조회
app.get('/api/online-agents', async (req, res) => {
  try {
    const keys = await redis.keys('online_status:*');
    const agents = [];
    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        agents.push(JSON.parse(data));
      }
    }
    res.json(agents);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback - API/recordings 외 모든 경로 → index.html
app.get('*', (req, res) => {
  const indexPath = path.join(dashboardPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).json({ error: 'Dashboard not found. Run: npm run build in dashboard/' });
  });
});

// DB 초기화 완료 후 서버 시작
db.ready().then(() => {
  // Socket.io 연동
  queueService.setSocketIO(io);

  // Worker 시작
  analysisWorker.start();

  server.listen(3000, '0.0.0.0', () => {
    console.log('🚀 Server running on 0.0.0.0:3000');
  });
}).catch(err => {
  console.error('❌ Failed to initialize database:', err);
  process.exit(1);
});
