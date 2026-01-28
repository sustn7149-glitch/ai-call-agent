import { useState, useEffect, useCallback } from 'react'
import { io } from 'socket.io-client'
import DetailModal from './components/DetailModal'

const socket = io('/', { transports: ['websocket', 'polling'] })

export default function App() {
  const [calls, setCalls] = useState([])
  const [stats, setStats] = useState(null)
  const [agents, setAgents] = useState([])
  const [selectedCall, setSelectedCall] = useState(null)
  const [connected, setConnected] = useState(false)

  const fetchCalls = useCallback(async () => {
    try {
      const res = await fetch('/api/calls')
      setCalls(await res.json())
    } catch (err) {
      console.error('Failed to fetch calls:', err)
    }
  }, [])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats')
      setStats(await res.json())
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  }, [])

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/online-agents')
      setAgents(await res.json())
    } catch (err) {
      console.error('Failed to fetch agents:', err)
    }
  }, [])

  const fetchAll = useCallback(() => {
    fetchCalls()
    fetchStats()
    fetchAgents()
  }, [fetchCalls, fetchStats, fetchAgents])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 30000)

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('call-status', fetchAll)
    socket.on('queue:job-completed', fetchAll)
    socket.on('queue:job-added', fetchAll)

    return () => {
      clearInterval(interval)
      socket.off('connect')
      socket.off('disconnect')
      socket.off('call-status')
      socket.off('queue:job-completed')
      socket.off('queue:job-added')
    }
  }, [fetchAll])

  const handleSelectCall = async (call) => {
    try {
      const res = await fetch(`/api/calls/${call.id}`)
      setSelectedCall(await res.json())
    } catch (err) {
      setSelectedCall(call)
    }
  }

  // Determine agent status based on calls
  const getAgentStatus = (agent) => {
    const agentCalls = calls.filter(c => c.uploader_phone === agent.userPhone)
    if (agentCalls.length === 0) return 'online'

    const latest = agentCalls[0]
    if (!latest.created_at) return 'online'

    const minutesAgo = (Date.now() - new Date(latest.created_at).getTime()) / 60000
    if (minutesAgo < 5) return 'oncall'
    return 'online'
  }

  const lastSeen = (agent) => {
    if (!agent.lastSeen) return ''
    const diff = (Date.now() - new Date(agent.lastSeen).getTime()) / 60000
    if (diff < 1) return '방금 전'
    if (diff < 60) return `${Math.floor(diff)}분 전`
    return `${Math.floor(diff / 60)}시간 전`
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold tracking-tight">AI Call Agent</h1>
          <span className="text-slate-400 text-sm">Management Dashboard</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <span className="text-sm text-slate-300">{connected ? '실시간 연결' : '연결 끊김'}</span>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto p-6 space-y-6">
        {/* Section A: Stats Cards */}
        <StatsSection stats={stats} />

        {/* Section B: Agent Status Board */}
        <AgentBoard agents={agents} getStatus={getAgentStatus} lastSeen={lastSeen} />

        {/* Section C: Call Analysis Table */}
        <CallTable calls={calls} onSelect={handleSelectCall} />
      </div>

      {/* Detail Modal */}
      {selectedCall && (
        <DetailModal call={selectedCall} onClose={() => setSelectedCall(null)} />
      )}
    </div>
  )
}

// ========== Section A: Stats Cards ==========
function StatsSection({ stats }) {
  if (!stats) return null

  const cards = [
    {
      label: '금일 총 통화',
      value: stats.todayTotal,
      unit: '건',
      color: 'bg-blue-500',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
        </svg>
      )
    },
    {
      label: '평균 통화시간',
      value: stats.avgDuration > 0 ? formatSeconds(stats.avgDuration) : '0:00',
      unit: '',
      color: 'bg-emerald-500',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    {
      label: '수신 통화',
      value: stats.incomingCount,
      unit: '건',
      color: 'bg-cyan-500',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5m0 0v5m0-5l-6 6M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.13a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.28 3H5z" />
        </svg>
      )
    },
    {
      label: '발신 통화',
      value: stats.outgoingCount,
      unit: '건',
      color: 'bg-violet-500',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 3h5m0 0v5m0-5l-6 6M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.13a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.28 3H5z" />
        </svg>
      )
    },
    {
      label: '부재중',
      value: stats.missedCount,
      unit: '건',
      color: 'bg-rose-500',
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      )
    }
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map((card) => (
        <div key={card.label} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4">
          <div className={`${card.color} text-white p-3 rounded-lg shrink-0`}>
            {card.icon}
          </div>
          <div>
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="text-2xl font-bold text-slate-800">
              {card.value}{card.unit && <span className="text-sm font-normal text-slate-400 ml-1">{card.unit}</span>}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ========== Section B: Agent Status Board ==========
function AgentBoard({ agents, getStatus, lastSeen }) {
  if (!agents.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">
          직원 현황
        </h2>
        <p className="text-slate-400 text-center py-4">현재 온라인 직원이 없습니다</p>
      </div>
    )
  }

  const statusConfig = {
    oncall: { dot: 'bg-amber-400', ring: 'ring-amber-100', label: '통화중', bg: 'bg-amber-50' },
    online: { dot: 'bg-emerald-400', ring: 'ring-emerald-100', label: '대기중', bg: 'bg-emerald-50' },
    offline: { dot: 'bg-slate-300', ring: 'ring-slate-100', label: '오프라인', bg: 'bg-slate-50' }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">
        직원 현황 ({agents.length}명 온라인)
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {agents.map((agent) => {
          const status = getStatus(agent)
          const cfg = statusConfig[status]
          return (
            <div key={agent.userPhone} className={`${cfg.bg} rounded-lg p-3 border border-slate-100`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot} ring-4 ${cfg.ring}`} />
                <span className="font-medium text-slate-700 text-sm truncate">{agent.userName}</span>
              </div>
              <div className="text-xs text-slate-400">
                <span>{cfg.label}</span>
                <span className="mx-1">·</span>
                <span>{lastSeen(agent)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ========== Section C: Call Analysis Table ==========
function CallTable({ calls, onSelect }) {
  if (!calls.length) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <p className="text-slate-400 text-lg">통화 기록이 없습니다</p>
        <p className="text-slate-300 text-sm mt-1">새 통화가 들어오면 여기에 표시됩니다</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
          상세 분석 ({calls.length}건)
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 text-left">
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">담당자</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">시간</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">구분</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">고객명</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">전화번호</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">요약</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">감정</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">점수</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">상태</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {calls.map((call) => (
              <tr
                key={call.id}
                onClick={() => onSelect(call)}
                className="hover:bg-blue-50 cursor-pointer transition-colors"
              >
                <td className="px-4 py-3 text-sm font-medium text-slate-700">
                  {call.uploader_name || ''}
                </td>
                <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">
                  {formatTime(call.created_at)}
                </td>
                <td className="px-4 py-3">
                  <DirectionBadge direction={call.direction} />
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {call.customer_name || ''}
                </td>
                <td className="px-4 py-3 text-sm text-slate-500 font-mono">
                  {call.phone_number || ''}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate">
                  {call.ai_summary || call.summary || ''}
                </td>
                <td className="px-4 py-3">
                  <EmotionBadge emotion={call.ai_emotion || call.sentiment} />
                </td>
                <td className="px-4 py-3">
                  <ScoreBadge score={call.ai_score} />
                </td>
                <td className="px-4 py-3">
                  <AiStatusBadge status={call.ai_status} analyzed={call.ai_analyzed} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button className="text-blue-500 hover:text-blue-700 text-sm font-medium">
                    상세
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ========== Badge Components ==========
function DirectionBadge({ direction }) {
  if (direction === 'OUT') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-700">발신</span>
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-cyan-100 text-cyan-700">수신</span>
}

function EmotionBadge({ emotion }) {
  if (!emotion) return <span className="text-slate-300 text-sm">-</span>
  const e = emotion.toLowerCase()
  if (e.includes('positive')) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">긍정</span>
  }
  if (e.includes('negative')) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-700">부정</span>
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">중립</span>
}

function ScoreBadge({ score }) {
  if (score == null) return <span className="text-slate-300 text-sm">-</span>

  let color = 'text-slate-600 bg-slate-100'
  if (score >= 7) color = 'text-emerald-700 bg-emerald-100'
  else if (score >= 4) color = 'text-amber-700 bg-amber-100'
  else color = 'text-rose-700 bg-rose-100'

  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-sm font-bold ${color}`}>
      {score}
    </span>
  )
}

function AiStatusBadge({ status, analyzed }) {
  if (analyzed === 1 || status === 'completed') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />완료
    </span>
  }
  if (status === 'processing') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />분석중
    </span>
  }
  if (status === 'failed') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-700">
      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />실패
    </span>
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">
    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />대기
  </span>
}

// ========== Utilities ==========
function formatTime(dateStr) {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    return date.toLocaleString('ko-KR', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return dateStr
  }
}

function formatSeconds(sec) {
  if (!sec) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
