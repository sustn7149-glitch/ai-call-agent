const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const Redis = require('ioredis');
const fs = require('fs');

const queueService = require('./services/queueService');
const upload = require('./services/uploadService');
const db = require('./services/databaseService');
const analysisWorker = require('./workers/analysisWorker');

const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Redis (Heartbeat + Call State)
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
app.post('/api/webhook/call', async (req, res) => {
  console.log('Call Event:', req.body);
  try {
    // Emit real-time event via socket.io (no DB insert - upload creates the real record)
    io.emit('call-status', req.body);

    // Store call state in Redis for LiveMonitor
    // Use raw userPhone (+82 format) as key to match online_status keys
    const { status, number, userPhone, userName, direction } = req.body;
    if (userPhone) {
      try {
        if (status === 'OFFHOOK' || status === 'RINGING') {
          await redis.set(`call_state:${userPhone}`, JSON.stringify({
            status: 'oncall',
            number: number || '',
            direction: direction || 'IN',
            userName: userName || '',
            startTime: new Date().toISOString()
          }), 'EX', 7200);
        } else if (status === 'IDLE') {
          await redis.del(`call_state:${userPhone}`);
        }
      } catch (redisErr) {
        console.error('[Webhook] Redis call state error:', redisErr.message);
      }
    }

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
    const { phoneNumber, userName, userPhone, callType, duration, contactName, startTime } = req.body;
    console.log(`Uploaded: ${file.filename} | type=${callType} | dur=${duration}s | start=${startTime || 'N/A'} | contact=${contactName || 'N/A'} | by ${userName || 'N/A'}`);

    // Duplicate check
    if (userPhone && startTime && db.checkDuplicate(userPhone, startTime)) {
      console.log(`[Duplicate] Skipped: uploader=${userPhone}, startTime=${startTime}`);
      try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
      return res.json({ success: true, duplicate: true, filename: file.filename });
    }

    // Auto-match team from agents table
    const teamName = userPhone ? db.getAgentTeam(userPhone) : null;

    const uploadData = {
      phoneNumber: phoneNumber || '',
      filePath: file.path,
      uploaderName: userName,
      uploaderPhone: userPhone,
      callType: callType || 'INCOMING',
      duration: duration || 0,
      contactName: contactName || null,
      teamName: teamName || null,
      startTime: startTime || null
    };

    // Save upload record directly (no need to match webhook rows anymore)
    let callId;
    try {
      const result = db.saveUploadRecord(uploadData);
      callId = result.lastInsertRowid;
    } catch (dupErr) {
      if (dupErr.message && dupErr.message.includes('UNIQUE')) {
        console.log(`[Upload] Duplicate detected via constraint: uploader=${userPhone}, startTime=${startTime}`);
        try { fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
        return res.json({ success: true, duplicate: true, filename: file.filename });
      }
      throw dupErr;
    }

    await queueService.addAnalysisJob({
      filePath: file.path,
      fileName: file.filename,
      phoneNumber: phoneNumber || '',
      callId: callId || undefined
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

  // Normalize phone: +821012345678 -> 01012345678
  const normalizedPhone = userPhone ? userPhone.replace(/^\+82/, '0') : userPhone;

  // Auto-register agent in DB (name only, preserves team assignment)
  try {
    db.ensureAgentExists(normalizedPhone, userName);
  } catch (e) {
    console.error('[Heartbeat] Agent auto-register failed:', e.message);
  }

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

// Agent daily breakdown for LiveMonitor
app.get('/api/agent-daily-stats', (req, res) => {
  try {
    res.json(db.getAgentDailyBreakdown());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Active call states from Redis for LiveMonitor
app.get('/api/call-states', async (req, res) => {
  try {
    const keys = await redis.keys('call_state:*');
    const states = {};
    for (const key of keys) {
      const phone = key.replace('call_state:', '');
      const data = await redis.get(key);
      if (data) states[phone] = JSON.parse(data);
    }
    res.json(states);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Online agents from Redis + agents table join
app.get('/api/online-agents', async (req, res) => {
  try {
    const keys = await redis.keys('online_status:*');
    const agents = [];
    for (const key of keys) {
      const data = await redis.get(key);
      if (data) {
        const agent = JSON.parse(data);
        const teamName = db.getAgentTeam(agent.userPhone);
        agent.teamName = teamName || null;
        agents.push(agent);
      }
    }
    res.json(agents);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ========== Reports API ==========
app.get('/api/reports/stats', (req, res) => {
  try {
    const { startDate, endDate, team } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate parameters required' });
    }
    const agents = db.getReportStats(startDate, endDate);

    // Filter by team if specified
    const filteredAgents = team
      ? agents.filter(a => a.team_name === team)
      : agents;

    // Build team summary
    const teamMap = {};
    agents.forEach(a => {
      const tn = a.team_name || '미지정';
      if (!teamMap[tn]) {
        teamMap[tn] = { team_name: tn, agent_count: 0, total_calls: 0, outgoing: 0, incoming: 0, missed: 0, total_duration: 0, score_sum: 0, score_count: 0 };
      }
      const t = teamMap[tn];
      t.agent_count++;
      t.total_calls += a.total_calls || 0;
      t.outgoing += a.outgoing || 0;
      t.incoming += a.incoming || 0;
      t.missed += a.missed || 0;
      t.total_duration += a.total_duration || 0;
      if (a.avg_score != null) { t.score_sum += a.avg_score; t.score_count++; }
    });
    const teams = Object.values(teamMap).map(t => ({
      ...t,
      avg_score: t.score_count > 0 ? Math.round((t.score_sum / t.score_count) * 10) / 10 : null,
    }));
    teams.forEach(t => { delete t.score_sum; delete t.score_count; });

    // Build global stats
    const globalStats = {
      agent_count: agents.length,
      total_calls: agents.reduce((s, a) => s + (a.total_calls || 0), 0),
      outgoing: agents.reduce((s, a) => s + (a.outgoing || 0), 0),
      incoming: agents.reduce((s, a) => s + (a.incoming || 0), 0),
      missed: agents.reduce((s, a) => s + (a.missed || 0), 0),
      total_duration: agents.reduce((s, a) => s + (a.total_duration || 0), 0),
      avg_score: (() => {
        const scored = agents.filter(a => a.avg_score != null);
        if (scored.length === 0) return null;
        return Math.round((scored.reduce((s, a) => s + a.avg_score, 0) / scored.length) * 10) / 10;
      })(),
    };

    res.json({ agents: filteredAgents, teams, globalStats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ========== Agents CRUD ==========
app.get('/api/agents', (req, res) => {
  try {
    res.json(db.getAllAgents());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/agents', (req, res) => {
  try {
    const result = db.upsertAgent(req.body);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/agents/:phone', (req, res) => {
  try {
    const result = db.updateAgent(req.params.phone, req.body);
    if (result.changes === 0) return res.status(404).json({ error: 'Agent not found' });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


app.delete('/api/agents/:phone', (req, res) => {
  try {
    const result = db.deleteAgent(req.params.phone);
    if (result.changes === 0) return res.status(404).json({ error: 'Agent not found' });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
// ========== Teams CRUD ==========
app.get('/api/teams', (req, res) => {
  try {
    res.json(db.getAllTeams());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/teams', (req, res) => {
  try {
    const { name, evaluation_prompt } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '팀 이름을 입력해주세요.' });
    }
    const result = db.createTeam({ name: name.trim(), evaluation_prompt });
    res.json(result);
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: '이미 존재하는 팀 이름입니다.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teams/:id', (req, res) => {
  try {
    const { name, evaluation_prompt } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '팀 이름을 입력해주세요.' });
    }
    const result = db.updateTeam(parseInt(req.params.id), { name: name.trim(), evaluation_prompt });
    if (result.changes === 0) return res.status(404).json({ error: 'Team not found' });
    res.json(result);
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: '이미 존재하는 팀 이름입니다.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teams/:id', (req, res) => {
  try {
    const result = db.deleteTeam(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Analytics
app.get('/api/analytics/daily', (req, res) => {
  try {
    res.json(db.getDailyAnalytics());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/team', (req, res) => {
  try {
    res.json(db.getTeamAnalytics());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analytics/direction', (req, res) => {
  try {
    res.json(db.getDirectionAnalytics());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Queue routes
const queueRoutes = require('./routes/queueRoutes');
app.use('/api/queue', queueRoutes);

// SPA fallback
app.get('*', (req, res) => {
  const indexPath = path.join(dashboardPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) res.status(404).json({ error: 'Dashboard not found. Run: npm run build in dashboard/' });
  });
});

// Start server after DB init
db.ready().then(() => {
  // Clean up junk rows from old webhook inserts (rows without recordings)
  db.cleanupJunkRows();

  queueService.setSocketIO(io);
  analysisWorker.start();

  server.listen(3000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:3000');
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
