import { useState, useEffect, useCallback, useMemo } from 'react'
import { formatDurationCompact } from '../utils'

// Date helpers (local timezone, not UTC)
const toDateStr = (d) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
const today = () => {
  const d = new Date(); d.setHours(0,0,0,0); return d
}

const QUICK_RANGES = [
  { label: '오늘', calc: () => { const d = today(); return [d, d] } },
  { label: '어제', calc: () => { const d = today(); d.setDate(d.getDate()-1); return [d, d] } },
  { label: '이번주', calc: () => {
    const d = today(); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const start = new Date(d); start.setDate(diff);
    return [start, today()]
  }},
  { label: '이번달', calc: () => {
    const d = today(); return [new Date(d.getFullYear(), d.getMonth(), 1), d]
  }},
  { label: '지난달', calc: () => {
    const d = today();
    const start = new Date(d.getFullYear(), d.getMonth()-1, 1);
    const end = new Date(d.getFullYear(), d.getMonth(), 0);
    return [start, end]
  }},
]

const TH = 'border border-gray-300 text-[12px] font-bold text-center text-gray-700 px-2 whitespace-nowrap'
const TD = 'border border-gray-300 text-[12px] text-center text-gray-700 px-2 whitespace-nowrap'
const TH_STYLE = { background: '#ECEBFF', height: '26px', position: 'sticky', top: 0, zIndex: 10 }

export default function Reports() {
  const [startDate, setStartDate] = useState(() => toDateStr(today()))
  const [endDate, setEndDate] = useState(() => toDateStr(today()))
  const [data, setData] = useState({ agents: [], teams: [], globalStats: {} })
  const [selectedTeam, setSelectedTeam] = useState(null)
  const [sortKey, setSortKey] = useState('avg_score')
  const [sortAsc, setSortAsc] = useState(false)
  const [loading, setLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ startDate, endDate })
      if (selectedTeam) params.set('team', selectedTeam)
      const res = await fetch(`/api/reports/stats?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (json.agents && json.teams) setData(json)
    } catch (err) {
      console.error('Failed to fetch report data:', err)
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, selectedTeam])

  useEffect(() => { fetchData() }, [fetchData])

  const handleQuickRange = (calc) => {
    const [s, e] = calc()
    setStartDate(toDateStr(s))
    setEndDate(toDateStr(e))
    setSelectedTeam(null)
  }

  const handleTeamClick = (teamName) => {
    setSelectedTeam(prev => (prev === teamName ? null : teamName))
  }

  // Sort agents
  const sortedAgents = useMemo(() => {
    const stringKeys = new Set(['uploader_name', 'team_name'])
    const list = [...data.agents]
    list.sort((a, b) => {
      const isStr = stringKeys.has(sortKey)
      let va = a[sortKey] ?? (isStr ? '' : -Infinity)
      let vb = b[sortKey] ?? (isStr ? '' : -Infinity)
      if (isStr) { va = String(va).toLowerCase(); vb = String(vb).toLowerCase() }
      if (va < vb) return sortAsc ? -1 : 1
      if (va > vb) return sortAsc ? 1 : -1
      return 0
    })
    return list
  }, [data.agents, sortKey, sortAsc])

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc(prev => !prev)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const sortArrow = (key) => {
    if (sortKey !== key) return <span className="text-[9px] text-gray-400 ml-0.5">{'\u25BC'}</span>
    return <span className="text-[9px] text-blue-600 ml-0.5">{sortAsc ? '\u25B2' : '\u25BC'}</span>
  }

  const { teams, globalStats } = data

  const globalTeam = globalStats?.total_calls != null
    ? {
        teamName: '전체',
        agent_count: globalStats.agent_count || 0,
        total_calls: globalStats.total_calls || 0,
        outgoing: globalStats.outgoing || 0,
        incoming: globalStats.incoming || 0,
        missed: globalStats.missed || 0,
        total_duration: globalStats.total_duration || 0,
        avg_score: globalStats.avg_score,
      }
    : null

  const allTeamRows = [
    ...(globalTeam ? [globalTeam] : []),
    ...teams.map(t => ({
      teamName: t.team_name,
      agent_count: t.agent_count || 0,
      total_calls: t.total_calls || 0,
      outgoing: t.outgoing || 0,
      incoming: t.incoming || 0,
      missed: t.missed || 0,
      total_duration: t.total_duration || 0,
      avg_score: t.avg_score,
    }))
  ]

  const fmtScore = (s) => {
    if (s == null || s === 0) return '-'
    return s
  }

  const scoreColor = (s) => {
    if (s == null || s === 0) return 'text-gray-400'
    if (s >= 7) return 'text-blue-700 font-bold'
    if (s >= 4) return 'text-gray-700'
    return 'text-red-600 font-bold'
  }

  return (
    <div className="px-3 py-3 flex flex-col" style={{ fontFamily: 'Pretendard, -apple-system, sans-serif', height: 'calc(100vh - 48px)' }}>

      {/* ── 필터 바 ── */}
      <div className="flex flex-wrap items-center gap-2 mb-2 bg-gray-50 border border-gray-300 px-3 py-1.5 shrink-0">
        <span className="text-[12px] font-bold text-gray-700 mr-1">기간</span>
        <div className="flex items-center gap-1">
          <input type="date" value={startDate} max={endDate}
            onChange={e => setStartDate(e.target.value)}
            className="border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 bg-white" />
          <span className="text-[11px] text-gray-400">~</span>
          <input type="date" value={endDate} min={startDate}
            onChange={e => setEndDate(e.target.value)}
            className="border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 bg-white" />
        </div>
        <div className="flex items-center gap-1">
          {QUICK_RANGES.map(r => (
            <button key={r.label} onClick={() => handleQuickRange(r.calc)}
              className="px-2 py-0.5 text-[11px] border border-gray-300 bg-white text-gray-600 hover:bg-gray-100">
              {r.label}
            </button>
          ))}
        </div>
        {loading && <span className="text-[11px] text-gray-400 animate-pulse">불러오는 중...</span>}
      </div>

      {/* ── 팀 요약 테이블 ── */}
      <div className="overflow-auto mb-2 shrink-0 border border-gray-300">
        <table style={{ borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: '80px' }} />
            <col style={{ width: '48px' }} />
            <col style={{ width: '64px' }} />
            <col style={{ width: '56px' }} />
            <col style={{ width: '56px' }} />
            <col style={{ width: '48px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '56px' }} />
          </colgroup>
          <thead>
            <tr>
              <th className={TH} style={TH_STYLE}>팀</th>
              <th className={TH} style={TH_STYLE}>인원</th>
              <th className={TH} style={TH_STYLE}>총통화</th>
              <th className={TH} style={TH_STYLE}>발신</th>
              <th className={TH} style={TH_STYLE}>수신</th>
              <th className={TH} style={TH_STYLE}>부재</th>
              <th className={TH} style={TH_STYLE}>총시간</th>
              <th className={TH} style={TH_STYLE}>AI점수</th>
            </tr>
          </thead>
          <tbody>
            {allTeamRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="border border-gray-300 text-center text-[12px] text-gray-400 py-4">
                  데이터가 없습니다
                </td>
              </tr>
            ) : (
              allTeamRows.map(t => {
                const isSelected = (t.teamName === '전체' && selectedTeam === null) || selectedTeam === t.teamName
                return (
                  <tr key={t.teamName}
                    onClick={() => t.teamName === '전체' ? setSelectedTeam(null) : handleTeamClick(t.teamName)}
                    className={`cursor-pointer ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    style={{ height: '28px' }}>
                    <td className={`${TD} font-medium ${isSelected ? 'text-blue-700' : ''}`}>{t.teamName}</td>
                    <td className={TD}>{t.agent_count}<span className="text-gray-400 text-[10px]">명</span></td>
                    <td className={`${TD} font-bold`}>{t.total_calls}</td>
                    <td className={`${TD} text-green-600`}>{t.outgoing}</td>
                    <td className={`${TD} text-red-600`}>{t.incoming}</td>
                    <td className={`${TD} ${t.missed > 0 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>{t.missed}</td>
                    <td className={`${TD} text-gray-600`}>{formatDurationCompact(t.total_duration)}</td>
                    <td className={`${TD} ${scoreColor(t.avg_score)}`}>{fmtScore(t.avg_score)}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── 필터 표시 ── */}
      <div className="flex items-center gap-2 mb-2 bg-gray-50 border border-gray-300 px-3 py-1.5 shrink-0">
        <span className="text-[12px] font-bold text-gray-700">직원별 성과</span>
        {selectedTeam && (
          <>
            <span className="text-[11px] text-blue-600 font-medium">{selectedTeam}</span>
            <button onClick={() => setSelectedTeam(null)}
              className="text-[11px] text-blue-600 hover:underline">초기화</button>
          </>
        )}
        <span className="text-[11px] text-gray-400 ml-auto">{sortedAgents.length}명</span>
      </div>

      {/* ── 성과 테이블 ── */}
      <div className="overflow-auto flex-1 border border-gray-300">
        <table style={{ borderCollapse: 'collapse' }}>
          <colgroup>
            <col style={{ width: '36px' }} />
            <col style={{ width: '72px' }} />
            <col style={{ width: '72px' }} />
            <col style={{ width: '80px' }} />
            <col style={{ width: '56px' }} />
            <col style={{ width: '48px' }} />
            <col style={{ width: '48px' }} />
            <col style={{ width: '48px' }} />
            <col style={{ width: '56px' }} />
          </colgroup>
          <thead>
            <tr>
              <th className={TH} style={TH_STYLE}>No.</th>
              <th className={`${TH} cursor-pointer hover:text-blue-600`} style={TH_STYLE}
                onClick={() => handleSort('uploader_name')}>이름{sortArrow('uploader_name')}</th>
              <th className={`${TH} cursor-pointer hover:text-blue-600`} style={TH_STYLE}
                onClick={() => handleSort('team_name')}>팀{sortArrow('team_name')}</th>
              <th className={`${TH} cursor-pointer hover:text-blue-600`} style={TH_STYLE}
                onClick={() => handleSort('total_duration')}>총통화시간{sortArrow('total_duration')}</th>
              <th className={`${TH} cursor-pointer hover:text-blue-600`} style={TH_STYLE}
                onClick={() => handleSort('total_calls')}>총통화{sortArrow('total_calls')}</th>
              <th className={`${TH} cursor-pointer hover:text-blue-600`} style={TH_STYLE}
                onClick={() => handleSort('outgoing')}>발신{sortArrow('outgoing')}</th>
              <th className={`${TH} cursor-pointer hover:text-blue-600`} style={TH_STYLE}
                onClick={() => handleSort('incoming')}>수신{sortArrow('incoming')}</th>
              <th className={`${TH} cursor-pointer hover:text-blue-600`} style={TH_STYLE}
                onClick={() => handleSort('missed')}>부재{sortArrow('missed')}</th>
              <th className={`${TH} cursor-pointer hover:text-blue-600`} style={TH_STYLE}
                onClick={() => handleSort('avg_score')}>AI점수{sortArrow('avg_score')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedAgents.length === 0 ? (
              <tr>
                <td colSpan={9} className="border border-gray-300 text-center text-[12px] text-gray-400 py-8">
                  해당 기간에 데이터가 없습니다
                </td>
              </tr>
            ) : (
              sortedAgents.map((agent, idx) => (
                <tr key={agent.uploader_phone} className="hover:bg-blue-50" style={{ height: '28px' }}>
                  <td className={`${TD} text-gray-500`}>{idx + 1}</td>
                  <td className={`${TD} font-medium`}>{agent.uploader_name || agent.uploader_phone}</td>
                  <td className={TD}>{agent.team_name || '미지정'}</td>
                  <td className={`${TD} text-gray-600 font-mono`}>{formatDurationCompact(agent.total_duration)}</td>
                  <td className={`${TD} font-bold text-gray-900`}>{agent.total_calls}</td>
                  <td className={`${TD} text-green-600`}>{agent.outgoing}</td>
                  <td className={`${TD} text-red-600`}>{agent.incoming}</td>
                  <td className={`${TD} ${agent.missed > 0 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>{agent.missed}</td>
                  <td className={`${TD} ${scoreColor(agent.avg_score)}`}>{fmtScore(agent.avg_score)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
