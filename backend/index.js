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

// Redis (Heartbeat)
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: 3,
});

app.use(cors());
app.use(express.json());
app.use('/recordings', express.static(process.env.RECORDINGS_PATH || path.join(__dirname, '../recordings')));

// Dashboard static files
const dashboardPath = process.env.DASHBOARD_PATH || path.join(__dirname, 'public');
app.use(express.static(dashboardPath));

// Webhook: call state events from Android
app.post('/api/webhook/call', (req, res) => {
  console.log('Call Event:', req.body);
  try {
    db.saveCallEvent(req.body);
    io.emit('call-status', req.body);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Upload: recording file + metadata from Android
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const file = req.file;
    const { phoneNumber, userName, userPhone, callType, duration, contactName } = req.body;
    console.log(`Uploaded: ${file.filename} | type=${callType} | dur=${duration}s | contact=${contactName || 'N/A'} | by ${userName || 'N/A'}`);

    const uploadData = {
      phoneNumber: phoneNumber || '',
      filePath: file.path,
      uploaderName: userName,
      uploaderPhone: userPhone,
      callType: callType || 'INCOMING',
      duration: duration || 0,
      contactName: contactName || null
    };

    // Try to match existing call record, else create new
    const result = db.updateRecording(uploadData);
    if (result.changes === 0) {
      db.saveUploadRecord(uploadData);
    }

    await queueService.addAnalysisJob({
      filePath: file.path,
      fileName: file.filename,
      phoneNumber: phoneNumber || ''
    });

    res.json({ success: true, filename: file.filename });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Heartbeat
app.post('/api/heartbeat', async (req, res) => {
  const { userName, userPhone } = req.body;
  console.log(`[Heartbeat] ${userName} (${userPhone}) is online`);

  try {
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

// Dashboard API: all calls with analysis
app.get('/api/calls', (req, res) => {
  try {
    const result = db.getAllCallsWithAnalysis();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Dashboard API: single call detail
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

// Dashboard API: today's stats
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.getTodayStats();
    const agentStats = db.getAgentStats();
    res.json({ ...stats, agentStats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Online agents from Redis
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

// SPA fallback
app.get('*', (req, res) => {
  const indexPath = path.join(dashboardPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).json({ error: 'Dashboard not found. Run: npm run build in dashboard/' });
  });
});

// Start server after DB init
db.ready().then(() => {
  queueService.setSocketIO(io);
  analysisWorker.start();

  server.listen(3000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:3000');
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
