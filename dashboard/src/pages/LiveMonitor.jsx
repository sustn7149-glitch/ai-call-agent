import { useState, useEffect, useCallback } from 'react'
import useSocket from '../hooks/useSocket'
import { formatDurationCompact, elapsedTimer } from '../utils'

export default function LiveMonitor() {
  const { socket } = useSocket()
  const [data, setData] = useState({ teams: [], agents: [], globalStats: null })
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [now, setNow] = useState(Date.now())

  // Live clock tick every second (for on-call timers)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/live-monitor')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.teams && json.agents) setData(json)
    } catch (err) {
      console.error('Failed to fetch live monitor data:', err)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)

    socket.on('call-status', fetchData)
    socket.on('queue:job-completed', fetchData)
    socket.on('queue:job-added', fetchData)

    return () => {
      clearInterval(interval)
      socket.off('call-status', fetchData)
      socket.off('queue:job-completed', fetchData)
      socket.off('queue:job-added', fetchData)
    }
  }, [socket, fetchData])

  const { teams, agents, globalStats } = data

  // Filter agents by selected team
  const filteredAgents = selectedTeam
    ? agents.filter(a => (a.teamName || '미지정') === selectedTeam)
    : agents

  // Sort: oncall first, then idle, then offline
  const statusOrder = { oncall: 0, idle: 1, offline: 2 }
  const sortedAgents = [...filteredAgents].sort(
    (a, b) => (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2)
  )

  const handleTeamClick = (teamName) => {
    setSelectedTeam(prev => (prev === teamName ? null : teamName))
  }

  // Global card data
  const globalTeam = globalStats
    ? {
        teamName: '전체',
        memberCount: agents.length,
        onlineCount: agents.filter(a => a.status !== 'offline').length,
        onCallCount: agents.filter(a => a.status === 'oncall').length,
      }
    : null

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Zone A: Team Selection Cards */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {globalTeam && (
          <TeamCard
            team={globalTeam}
            selected={selectedTeam === null}
            onClick={() => setSelectedTeam(null)}
          />
        )}
        {teams.map(team => (
          <TeamCard
            key={team.teamName}
            team={team}
            selected={selectedTeam === team.teamName}
            onClick={() => handleTeamClick(team.teamName)}
          />
        ))}
      </div>

      {/* Zone B: High-Density Agent Table */}
      <div className="bg-surface border border-line rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line bg-surface-panel">
                <th className="px-2 py-2 text-center text-xs font-medium text-ink-tertiary whitespace-nowrap w-[40px]">No</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-ink-tertiary whitespace-nowrap">팀</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-ink-tertiary whitespace-nowrap">이름</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-ink-tertiary whitespace-nowrap">PC접속</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-ink-tertiary whitespace-nowrap">업무상태</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-ink-tertiary whitespace-nowrap">경과시간</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-ink-tertiary whitespace-nowrap">상대번호</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-ink-tertiary whitespace-nowrap border-l border-line-light">총</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-ink-tertiary whitespace-nowrap">발신</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-ink-tertiary whitespace-nowrap">수신</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-ink-tertiary whitespace-nowrap">부재</th>
                <th className="px-2 py-2 text-center text-xs font-medium text-ink-tertiary whitespace-nowrap">총시간</th>
              </tr>
            </thead>
            <tbody>
              {sortedAgents.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-xs text-ink-tertiary">
                    {selectedTeam
                      ? `${selectedTeam}에 등록된 에이전트가 없습니다`
                      : '등록된 에이전트가 없습니다'}
                  </td>
                </tr>
              ) : (
                sortedAgents.map((agent, idx) => (
                  <AgentRow key={agent.phone} agent={agent} now={now} rowNum={idx + 1} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ─── Team Selection Card ─── */
function TeamCard({ team, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 min-w-[140px] rounded-lg border px-3 py-2 text-left transition-all ${
        selected
          ? 'border-brand bg-brand-light ring-1 ring-brand/30'
          : 'border-line bg-surface hover:border-ink-tertiary'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${selected ? 'text-brand' : 'text-ink'}`}>
          {team.teamName}
        </span>
        <span className="text-xs text-ink-tertiary">
          {team.onCallCount > 0 && (
            <span className="text-positive font-medium mr-1">{team.onCallCount}통화</span>
          )}
          {team.memberCount}명
        </span>
      </div>
    </button>
  )
}

/* ─── Agent Table Row ─── */
const STATUS_CONFIG = {
  oncall:  { label: '상담중', dot: 'bg-positive',     text: 'text-positive' },
  idle:    { label: '대기',   dot: 'bg-ink-tertiary',  text: 'text-ink-secondary' },
  offline: { label: '-',      dot: 'bg-line',          text: 'text-ink-tertiary' },
}

function AgentRow({ agent, now, rowNum }) {
  const isOnCall = agent.status === 'oncall'
  const isOffline = agent.status === 'offline'
  const isOnline = !isOffline
  const s = agent.todayStats
  const cfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.offline

  const answered = Math.max(0, s.incoming - s.missed)

  // Live elapsed timer for on-call agents
  const elapsed = (isOnCall && agent.callStartTime)
    ? (elapsedTimer(agent.callStartTime, now) ?? '-')
    : '-'

  return (
    <tr className={`border-b border-line-light last:border-b-0 transition-colors ${
      isOnCall ? 'bg-positive-bg' : ''
    }`}>
      {/* No */}
      <td className="px-2 py-1.5 text-center">
        <span className="text-xs text-ink-tertiary">{rowNum}</span>
      </td>

      {/* 팀 */}
      <td className="px-2 py-1.5">
        <span className="text-xs text-ink-secondary truncate max-w-[80px] block">
          {agent.teamName || '미지정'}
        </span>
      </td>

      {/* 이름 */}
      <td className="px-2 py-1.5">
        <span className={`text-xs font-medium truncate max-w-[100px] block ${
          isOffline ? 'text-ink-tertiary' : 'text-ink'
        }`}>
          {agent.name}
        </span>
      </td>

      {/* PC접속 */}
      <td className="px-2 py-1.5 text-center">
        {isOnline ? (
          <span className="inline-flex items-center gap-1 text-xs text-positive">
            <span className="w-1.5 h-1.5 rounded-full bg-positive" />접속
          </span>
        ) : (
          <span className="text-xs text-ink-tertiary">-</span>
        )}
      </td>

      {/* 업무상태 */}
      <td className="px-2 py-1.5 text-center">
        {isOffline ? (
          <span className="text-xs text-ink-tertiary">-</span>
        ) : (
          <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
        )}
      </td>

      {/* 경과시간 */}
      <td className="px-2 py-1.5 text-center">
        <span className={`text-xs font-mono ${
          isOnCall ? 'text-positive font-medium' : 'text-ink-tertiary'
        }`}>
          {elapsed}
        </span>
      </td>

      {/* 상대번호 */}
      <td className="px-2 py-1.5">
        <span className="text-xs text-ink-secondary font-mono">
          {isOnCall && agent.callNumber ? agent.callNumber : '-'}
        </span>
      </td>

      {/* 금일 통화 현황 */}
      <td className="px-2 py-1.5 text-center border-l border-line-light">
        <span className="text-xs font-semibold text-ink">{s.total}</span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className="text-xs text-ink-secondary">{s.outgoing}</span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className="text-xs text-ink-secondary">{answered}</span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className={`text-xs ${
          s.missed > 0 ? 'text-negative font-medium' : 'text-ink-secondary'
        }`}>
          {s.missed}
        </span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className="text-xs text-ink-secondary font-mono">
          {formatDurationCompact(s.totalDuration)}
        </span>
      </td>
    </tr>
  )
}
