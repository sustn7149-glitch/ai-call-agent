import { useState, useEffect, useCallback, useRef } from 'react'
import useSocket from '../hooks/useSocket'

const TH = 'border border-gray-300 text-[12px] font-bold text-center text-gray-700 px-2 whitespace-nowrap'
const TD = 'border border-gray-300 text-[12px] text-center text-gray-700 px-2'
const TH_STYLE = { background: '#ECEBFF', height: '26px', position: 'sticky', top: 0, zIndex: 10 }

export default function LiveMonitor() {
  const { socket } = useSocket()
  const [stats, setStats] = useState(null)
  const [agents, setAgents] = useState([])
  const [agentDailyStats, setAgentDailyStats] = useState([])
  const [callStates, setCallStates] = useState({})
  const [selectedTeam, setSelectedTeam] = useState('')
  const [now, setNow] = useState(Date.now())
  const timerRef = useRef(null)

  useEffect(() => {
    timerRef.current = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timerRef.current)
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

  const fetchAgentDailyStats = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-daily-stats')
      setAgentDailyStats(await res.json())
    } catch (err) {
      console.error('Failed to fetch agent daily stats:', err)
    }
  }, [])

  const fetchCallStates = useCallback(async () => {
    try {
      const res = await fetch('/api/call-states')
      setCallStates(await res.json())
    } catch (err) {
      console.error('Failed to fetch call states:', err)
    }
  }, [])

  const fetchAll = useCallback(() => {
    fetchStats()
    fetchAgents()
    fetchAgentDailyStats()
    fetchCallStates()
  }, [fetchStats, fetchAgents, fetchAgentDailyStats, fetchCallStates])

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 15000)

    const handleCallStatus = (data) => {
      if (data && data.userPhone) {
        if (data.status === 'OFFHOOK' || data.status === 'RINGING') {
          setCallStates(prev => ({
            ...prev,
            [data.userPhone]: {
              status: 'oncall',
              number: data.number || '',
              direction: data.direction || 'IN',
              startTime: new Date().toISOString()
            }
          }))
        } else if (data.status === 'IDLE') {
          setCallStates(prev => {
            const next = { ...prev }
            delete next[data.userPhone]
            return next
          })
        }
      }
      setTimeout(() => {
        fetchStats()
        fetchAgentDailyStats()
      }, 1000)
    }

    socket.on('call-status', handleCallStatus)
    socket.on('queue:job-completed', fetchAll)

    return () => {
      clearInterval(interval)
      socket.off('call-status', handleCallStatus)
      socket.off('queue:job-completed', fetchAll)
    }
  }, [socket, fetchAll, fetchStats, fetchAgentDailyStats])

  const uniqueAgents = (() => {
    const seen = new Set()
    return agents.filter(agent => {
      if (seen.has(agent.userPhone)) return false
      seen.add(agent.userPhone)
      return true
    })
  })()

  const mergedAgents = (() => {
    const map = new Map()
    uniqueAgents.forEach(a => {
      map.set(a.userPhone, {
        phone: a.userPhone,
        name: a.userName,
        team: a.teamName || '미지정',
        totalCalls: 0, outgoing: 0, incoming: 0, missed: 0, totalDuration: 0
      })
    })
    agentDailyStats.forEach(s => {
      const phone = s.uploader_phone
      if (map.has(phone)) {
        const row = map.get(phone)
        row.totalCalls = s.total_calls || 0
        row.outgoing = s.outgoing_calls || 0
        row.incoming = s.incoming_calls || 0
        row.missed = s.missed_calls || 0
        row.totalDuration = s.total_duration || 0
        if (s.team_name) row.team = s.team_name
      } else {
        map.set(phone, {
          phone,
          name: s.uploader_name || phone,
          team: s.team_name || '미지정',
          totalCalls: s.total_calls || 0,
          outgoing: s.outgoing_calls || 0,
          incoming: s.incoming_calls || 0,
          missed: s.missed_calls || 0,
          totalDuration: s.total_duration || 0
        })
      }
    })
    return Array.from(map.values())
  })()

  const teamList = (() => {
    const s = new Set()
    mergedAgents.forEach(a => { if (a.team) s.add(a.team) })
    return Array.from(s).sort()
  })()

  const teamSummary = (() => {
    const teams = {}
    mergedAgents.forEach(a => {
      const t = a.team || '미지정'
      if (!teams[t]) teams[t] = { name: t, total: 0, oncall: 0, todayCalls: 0 }
      teams[t].total++
      teams[t].todayCalls += a.totalCalls
      if (callStates[a.phone]) teams[t].oncall++
    })
    return Object.values(teams).sort((a, b) => b.todayCalls - a.todayCalls)
  })()

  const filteredAgents = selectedTeam
    ? mergedAgents.filter(a => a.team === selectedTeam)
    : mergedAgents

  const sortedAgents = [...filteredAgents].sort((a, b) => {
    const aOncall = callStates[a.phone] ? 1 : 0
    const bOncall = callStates[b.phone] ? 1 : 0
    if (aOncall !== bOncall) return bOncall - aOncall
    return b.totalCalls - a.totalCalls
  })

  const getElapsedText = (phone) => {
    const state = callStates[phone]
    if (!state || !state.startTime) return ''
    const elapsed = Math.floor((now - new Date(state.startTime).getTime()) / 1000)
    if (elapsed < 0) return '0:00'
    const m = Math.floor(elapsed / 60)
    const s = elapsed % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const fmtDurHM = (sec) => {
    if (!sec) return '-'
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  const totalOnline = mergedAgents.length
  const totalOncall = mergedAgents.filter(a => callStates[a.phone]).length
  const totalCallsToday = mergedAgents.reduce((s, a) => s + a.totalCalls, 0)

  return (
    <div className="px-3 py-3 flex flex-col" style={{ fontFamily: 'Pretendard, -apple-system, sans-serif', height: 'calc(100vh - 48px)' }}>

      {/* ── 요약 카드 바 ── */}
      <div className="flex items-stretch gap-0 mb-2 shrink-0">
        <div className="border border-gray-300 px-4 py-2 bg-gray-50 flex-1 text-center">
          <div className="text-[11px] text-gray-500">접속 인원</div>
          <div className="text-[18px] font-bold text-gray-800">{totalOnline}<span className="text-[11px] font-normal text-gray-400">명</span></div>
        </div>
        <div className="border border-gray-300 border-l-0 px-4 py-2 bg-green-50 flex-1 text-center">
          <div className="text-[11px] text-green-600">상담중</div>
          <div className="text-[18px] font-bold text-green-700">{totalOncall}<span className="text-[11px] font-normal text-gray-400">명</span></div>
        </div>
        <div className="border border-gray-300 border-l-0 px-4 py-2 bg-blue-50 flex-1 text-center">
          <div className="text-[11px] text-blue-600">금일 통화</div>
          <div className="text-[18px] font-bold text-blue-700">{totalCallsToday}<span className="text-[11px] font-normal text-gray-400">건</span></div>
        </div>
        {teamSummary.map(t => (
          <div key={t.name}
            onClick={() => setSelectedTeam(selectedTeam === t.name ? '' : t.name)}
            className={`border border-gray-300 border-l-0 px-4 py-2 flex-1 text-center cursor-pointer transition-colors ${
              selectedTeam === t.name ? 'bg-blue-100' : 'bg-white hover:bg-gray-50'
            }`}>
            <div className="text-[11px] text-gray-500">{t.name}</div>
            <div className="text-[14px] font-bold text-gray-800">
              {t.oncall}<span className="text-gray-400 font-normal">/{t.total}</span>
            </div>
            <div className="text-[10px] text-gray-400">{t.todayCalls}건</div>
          </div>
        ))}
      </div>

      {/* ── 필터 바 ── */}
      <div className="flex items-center gap-2 mb-2 bg-gray-50 border border-gray-300 px-3 py-1.5 shrink-0">
        <span className="text-[12px] font-bold text-gray-700">직원 현황</span>
        <div className="flex items-center gap-1 ml-2">
          <label className="text-[11px] text-gray-500">팀</label>
          <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)}
            className="border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 bg-white">
            <option value="">전체</option>
            {teamList.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {selectedTeam && (
          <button onClick={() => setSelectedTeam('')}
            className="text-[11px] text-blue-600 hover:underline">초기화</button>
        )}
        <span className="text-[11px] text-gray-400 ml-auto">{sortedAgents.length}명</span>
      </div>

      {/* ── 테이블 ── */}
      <div className="overflow-auto flex-1 border border-gray-300">
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className={TH} style={TH_STYLE}>No.</th>
              <th className={TH} style={TH_STYLE}>팀</th>
              <th className={TH} style={TH_STYLE}>이름</th>
              <th className={TH} style={TH_STYLE}>업무상태</th>
              <th className={TH} style={TH_STYLE}>경과시간</th>
              <th className={TH} style={TH_STYLE}>상대번호</th>
              <th className={TH} style={TH_STYLE}>구분</th>
              <th className={TH} style={TH_STYLE}>총통화</th>
              <th className={TH} style={TH_STYLE}>발신</th>
              <th className={TH} style={TH_STYLE}>수신</th>
              <th className={TH} style={TH_STYLE}>부재</th>
              <th className={TH} style={TH_STYLE}>총시간</th>
            </tr>
          </thead>
          <tbody>
            {sortedAgents.length === 0 ? (
              <tr>
                <td colSpan={12} className="border border-gray-300 text-center text-[12px] text-gray-400 py-8">
                  현재 온라인 직원이 없습니다
                </td>
              </tr>
            ) : (
              sortedAgents.map((agent, idx) => {
                const isOncall = !!callStates[agent.phone]
                const state = callStates[agent.phone]
                return (
                  <tr key={agent.phone}
                    className={isOncall ? 'bg-green-50' : 'hover:bg-blue-50'}
                    style={{ height: '28px' }}>
                    <td className={`${TD} text-gray-500`}>{idx + 1}</td>
                    <td className={TD}>{agent.team}</td>
                    <td className={`${TD} font-medium`}>{agent.name}</td>
                    <td className={TD}>
                      {isOncall ? (
                        <span className="text-green-700 font-bold flex items-center justify-center gap-1">
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          상담중
                        </span>
                      ) : (
                        <span className="text-gray-400">대기</span>
                      )}
                    </td>
                    <td className={`${TD} font-mono`}>
                      {isOncall ? (
                        <span className="text-green-700 font-bold">{getElapsedText(agent.phone)}</span>
                      ) : '-'}
                    </td>
                    <td className={`${TD} font-mono text-gray-600`}>
                      {isOncall && state?.number ? state.number : '-'}
                    </td>
                    <td className={TD}>
                      {isOncall && state ? (
                        <span className={
                          state.direction === 'OUT'
                            ? 'text-green-600 bg-green-50 px-1.5 py-0.5 rounded-sm'
                            : 'text-red-600 bg-red-50 px-1.5 py-0.5 rounded-sm'
                        }>
                          {state.direction === 'OUT' ? '발신' : '수신'}
                        </span>
                      ) : '-'}
                    </td>
                    <td className={`${TD} font-bold text-gray-900`}>{agent.totalCalls}</td>
                    <td className={`${TD} text-green-600`}>{agent.outgoing}</td>
                    <td className={`${TD} text-red-600`}>{agent.incoming}</td>
                    <td className={`${TD} text-gray-500`}>{agent.missed}</td>
                    <td className={`${TD} text-gray-600`}>{fmtDurHM(agent.totalDuration)}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
