import { useState, useEffect, useCallback } from 'react'
import useSocket from '../hooks/useSocket'
import { formatSeconds, lastSeenText } from '../utils'

export default function LiveMonitor() {
  const { socket } = useSocket()
  const [stats, setStats] = useState(null)
  const [agents, setAgents] = useState([])

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
    fetchStats()
    fetchAgents()
  }, [fetchStats, fetchAgents])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 30000)

    socket.on('call-status', fetchAll)
    socket.on('queue:job-completed', fetchAll)
    socket.on('queue:job-added', fetchAll)

    return () => {
      clearInterval(interval)
      socket.off('call-status', fetchAll)
      socket.off('queue:job-completed', fetchAll)
      socket.off('queue:job-added', fetchAll)
    }
  }, [socket, fetchAll])

  // Deduplicate agents by userPhone, then group by team
  const uniqueAgents = (() => {
    const seen = new Set()
    return agents.filter(agent => {
      if (seen.has(agent.userPhone)) return false
      seen.add(agent.userPhone)
      return true
    })
  })()

  const grouped = {}
  uniqueAgents.forEach((agent) => {
    const team = agent.teamName || '미지정'
    if (!grouped[team]) grouped[team] = []
    grouped[team].push(agent)
  })

  const statusConfig = {
    oncall:  { dot: 'bg-caution', label: '통화중' },
    online:  { dot: 'bg-positive', label: '대기중' },
    offline: { dot: 'bg-ink-tertiary', label: '오프라인' },
  }

  const getAgentStatus = (agent) => {
    if (!agent.lastSeen) return 'online'
    const minutesAgo = (Date.now() - new Date(agent.lastSeen).getTime()) / 60000
    if (minutesAgo < 5) return 'oncall'
    return 'online'
  }

  const cards = stats ? [
    { label: '금일 총 통화', value: stats.todayTotal, unit: '건' },
    { label: '평균 통화시간', value: stats.avgDuration > 0 ? formatSeconds(stats.avgDuration) : '0:00', unit: '' },
    { label: '수신 통화', value: stats.incomingCount, unit: '건' },
    { label: '발신 통화', value: stats.outgoingCount, unit: '건' },
    { label: '부재중', value: stats.missedCount, unit: '건' },
  ] : []

  return (
    <div className="px-6 py-5 space-y-5">
      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {cards.map((card) => (
            <div key={card.label} className="bg-surface border border-line rounded-lg px-4 py-3.5">
              <p className="text-sm text-ink-tertiary mb-1">{card.label}</p>
              <p className="text-2xl font-semibold text-ink">
                {card.value}
                {card.unit && <span className="text-sm font-normal text-ink-tertiary ml-1">{card.unit}</span>}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Agent Board - grouped by team */}
      <div className="bg-surface border border-line rounded-lg px-5 py-4">
        <h2 className="text-sm font-medium text-ink-tertiary mb-3">
          직원 현황 {uniqueAgents.length > 0 && <span className="text-ink-secondary">({uniqueAgents.length}명 온라인)</span>}
        </h2>
        {uniqueAgents.length === 0 ? (
          <p className="text-sm text-ink-tertiary text-center py-3">현재 온라인 직원이 없습니다</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([team, members]) => (
              <div key={team}>
                <p className="text-xs font-medium text-ink-tertiary mb-2">{team}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
                  {members.map((agent) => {
                    const status = getAgentStatus(agent)
                    const cfg = statusConfig[status]
                    return (
                      <div key={agent.userPhone} className="bg-surface-panel rounded px-3 py-2.5">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`w-[7px] h-[7px] rounded-full ${cfg.dot}`} />
                          <span className="font-medium text-sm text-ink truncate">{agent.userName}</span>
                        </div>
                        <p className="text-xs text-ink-tertiary pl-[15px]">
                          {cfg.label} · {lastSeenText(agent)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
