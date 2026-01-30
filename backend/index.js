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
    const { phoneNumber, userName, userPhone, callType, duration, contactName, startTime } = req.body;
    console.log(`Uploaded: ${file.filename} | type=${callType} | dur=${duration}s | start=${startTime || 'N/A'} | contact=${contactName || 'N/A'} | by ${userName || 'N/A'}`);

    // Duplicate check: same uploader + same call start time = same call
    if (userPhone && startTime && db.checkDuplicate(userPhone, startTime)) {
      console.log(`[Duplicate] Skipped: uploader=${userPhone}, startTime=${startTime}`);
      // Remove the uploaded file since it's a duplicate
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

// Heartbeat (enhanced: accepts optional call state from Android)
app.post('/api/heartbeat', async (req, res) => {
  const { userName, userPhone, callState, callNumber, callStartTime } = req.body;
  console.log(`[Heartbeat] ${userName} (${userPhone}) state=${callState || 'idle'}`);

  try {
    const key = `online_status:${userPhone}`;
    const value = JSON.stringify({
      userName,
      userPhone,
      lastSeen: new Date().toISOString(),
      callState: callState || 'idle',
      callNumber: callNumber || null,
      callStartTime: callStartTime || null
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

// Live Monitor: combined team summaries + agent list with daily stats
app.get('/api/live-monitor', async (req, res) => {
  try {
    // 1. Registered agents from DB
    const registeredAgents = db.getAllAgents();

    // 2. Online agents from Redis (batch read)
    const keys = await redis.keys('online_status:*');
    const onlineMap = {};
    if (keys.length > 0) {
      const values = await redis.mget(keys);
      values.forEach((data) => {
        if (data) {
          const agent = JSON.parse(data);
          onlineMap[agent.userPhone] = agent;
        }
      });
    }

    // 3. Per-agent daily stats from DB
    const statsMap = db.getAgentDailyStatsMap();

    // 4. Build agent list (registered + unregistered-but-online)
    const seen = new Set();
    const agentList = [];

    for (const reg of registeredAgents) {
      seen.add(reg.phone_number);
      const online = onlineMap[reg.phone_number];
      const stats = statsMap[reg.phone_number];

      agentList.push({
        name: reg.name || (online && online.userName) || reg.phone_number,
        phone: reg.phone_number,
        teamName: reg.team_name || null,
        status: online
          ? ((online.callState === 'oncall') ? 'oncall' : 'idle')
          : 'offline',
        lastSeen: online ? online.lastSeen : null,
        callNumber: online ? online.callNumber : null,
        callStartTime: online ? online.callStartTime : null,
        todayStats: {
          total: stats ? stats.total_calls : 0,
          outgoing: stats ? stats.outgoing : 0,
          incoming: stats ? stats.incoming : 0,
          missed: stats ? stats.missed : 0,
          totalDuration: stats ? stats.total_duration : 0,
        },
        lastCallAt: stats ? stats.last_call_at : null,
      });
    }

    // Include online but unregistered agents
    for (const phone of Object.keys(onlineMap)) {
      if (!seen.has(phone)) {
        const online = onlineMap[phone];
        const stats = statsMap[phone];

        agentList.push({
          name: online.userName || phone,
          phone,
          teamName: null,  // Not in agents table by definition
          status: (online.callState === 'oncall') ? 'oncall' : 'idle',
          lastSeen: online.lastSeen,
          callNumber: online.callNumber || null,
          callStartTime: online.callStartTime || null,
          todayStats: {
            total: stats ? stats.total_calls : 0,
            outgoing: stats ? stats.outgoing : 0,
            incoming: stats ? stats.incoming : 0,
            missed: stats ? stats.missed : 0,
            totalDuration: stats ? stats.total_duration : 0,
          },
          lastCallAt: stats ? stats.last_call_at : null,
        });
      }
    }

    // 5. Build team summaries
    const teamMap = {};
    for (const agent of agentList) {
      const team = agent.teamName || '미지정';
      if (!teamMap[team]) {
        teamMap[team] = {
          teamName: team,
          memberCount: 0,
          onlineCount: 0,
          onCallCount: 0,
          todayStats: { total: 0, outgoing: 0, incoming: 0, missed: 0, totalDuration: 0 }
        };
      }
      const t = teamMap[team];
      t.memberCount++;
      if (agent.status !== 'offline') t.onlineCount++;
      if (agent.status === 'oncall') t.onCallCount++;
      t.todayStats.total += agent.todayStats.total;
      t.todayStats.outgoing += agent.todayStats.outgoing;
      t.todayStats.incoming += agent.todayStats.incoming;
      t.todayStats.missed += agent.todayStats.missed;
      t.todayStats.totalDuration += agent.todayStats.totalDuration;
    }

    // 6. Global totals
    const globalStats = { total: 0, outgoing: 0, incoming: 0, missed: 0, totalDuration: 0 };
    for (const t of Object.values(teamMap)) {
      globalStats.total += t.todayStats.total;
      globalStats.outgoing += t.todayStats.outgoing;
      globalStats.incoming += t.todayStats.incoming;
      globalStats.missed += t.todayStats.missed;
      globalStats.totalDuration += t.todayStats.totalDuration;
    }

    res.json({
      teams: Object.values(teamMap),
      agents: agentList,
      globalStats
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Teams CRUD
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
    const { name, description, evaluation_prompt } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '팀 이름은 필수입니다' });
    }
    const result = db.createTeam({ name, description, evaluation_prompt });
    res.json(result);
  } catch (err) {
    console.error(err);
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: '이미 존재하는 팀 이름입니다' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/teams/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid team ID' });
    const result = db.updateTeam(id, req.body);
    if (result.changes === 0) return res.status(404).json({ error: 'Team not found' });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/teams/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid team ID' });
    const result = db.deleteTeam(id);
    if (result.changes === 0) return res.status(404).json({ error: 'Team not found' });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// Agents CRUD
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

// Reports: period-based agent performance stats
app.get('/api/reports/stats', (req, res) => {
  try {
    const { startDate, endDate, team } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ error: 'startDate must not be after endDate' });
    }
    const result = db.getReportStats(startDate, endDate, team || null);
    res.json(result);
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
