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

  // Sort agents (type-safe: string keys use '' fallback, numeric keys use -Infinity)
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

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Zone A: Date Filter */}
      <div className="bg-surface border border-line rounded-lg px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date inputs */}
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              max={endDate}
              onChange={e => setStartDate(e.target.value)}
              className="border border-line rounded px-2 py-1.5 text-sm text-ink bg-surface focus:border-brand focus:outline-none"
            />
            <span className="text-xs text-ink-tertiary">~</span>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={e => setEndDate(e.target.value)}
              className="border border-line rounded px-2 py-1.5 text-sm text-ink bg-surface focus:border-brand focus:outline-none"
            />
          </div>

          {/* Quick select buttons */}
          <div className="flex gap-1.5">
            {QUICK_RANGES.map(r => (
              <button
                key={r.label}
                onClick={() => handleQuickRange(r.calc)}
                className="px-2.5 py-1.5 text-xs rounded border border-line bg-surface-panel text-ink-secondary hover:border-brand hover:text-brand transition-colors"
              >
                {r.label}
              </button>
            ))}
          </div>

          {loading && (
            <span className="text-xs text-ink-tertiary animate-pulse">불러오는 중...</span>
          )}
        </div>
      </div>

      {/* Zone B: Team Summary Cards */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {globalTeam && (
          <ReportTeamCard
            team={globalTeam}
            selected={selectedTeam === null}
            onClick={() => setSelectedTeam(null)}
          />
        )}
        {teams.map(team => (
          <ReportTeamCard
            key={team.team_name}
            team={{
              teamName: team.team_name,
              agent_count: team.agent_count || 0,
              total_calls: team.total_calls || 0,
              outgoing: team.outgoing || 0,
              incoming: team.incoming || 0,
              missed: team.missed || 0,
              total_duration: team.total_duration || 0,
              avg_score: team.avg_score,
            }}
            selected={selectedTeam === team.team_name}
            onClick={() => handleTeamClick(team.team_name)}
          />
        ))}
      </div>

      {/* Zone C: Detailed Performance Table */}
      <div className="bg-surface border border-line rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line bg-surface-panel">
                <th className="px-2 py-2 text-center text-xs font-medium text-ink-tertiary whitespace-nowrap w-[40px]">No</th>
                <SortTh label="이름" sortKey="uploader_name" currentKey={sortKey} asc={sortAsc} onClick={handleSort} align="left" />
                <SortTh label="팀" sortKey="team_name" currentKey={sortKey} asc={sortAsc} onClick={handleSort} align="left" />
                <SortTh label="총 통화시간" sortKey="total_duration" currentKey={sortKey} asc={sortAsc} onClick={handleSort} />
                <SortTh label="총 통화수" sortKey="total_calls" currentKey={sortKey} asc={sortAsc} onClick={handleSort} />
                <SortTh label="발신" sortKey="outgoing" currentKey={sortKey} asc={sortAsc} onClick={handleSort} />
                <SortTh label="수신" sortKey="incoming" currentKey={sortKey} asc={sortAsc} onClick={handleSort} />
                <SortTh label="부재" sortKey="missed" currentKey={sortKey} asc={sortAsc} onClick={handleSort} />
                <SortTh label="평균 AI점수" sortKey="avg_score" currentKey={sortKey} asc={sortAsc} onClick={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sortedAgents.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-xs text-ink-tertiary">
                    해당 기간에 데이터가 없습니다
                  </td>
                </tr>
              ) : (
                sortedAgents.map((agent, idx) => (
                  <ReportRow key={agent.uploader_phone} agent={agent} rowNum={idx + 1} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ─── Sortable Table Header ─── */
function SortTh({ label, sortKey, currentKey, asc, onClick, align = 'center' }) {
  const active = currentKey === sortKey
  return (
    <th
      className={`px-2 py-2 text-xs font-medium text-ink-tertiary whitespace-nowrap cursor-pointer hover:text-ink select-none ${
        align === 'left' ? 'text-left' : 'text-center'
      }`}
      onClick={() => onClick(sortKey)}
    >
      {label}
      <span className={`ml-0.5 text-[9px] ${active ? 'text-brand' : 'text-ink-tertiary opacity-40'}`}>
        {active ? (asc ? '\u25B2' : '\u25BC') : '\u25BC'}
      </span>
    </th>
  )
}

/* ─── Report Team Summary Card ─── */
function ReportTeamCard({ team, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 min-w-[180px] rounded-lg border px-3 py-2.5 text-left transition-all ${
        selected
          ? 'border-brand bg-brand-light ring-1 ring-brand/30'
          : 'border-line bg-surface hover:border-ink-tertiary'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className={`text-sm font-semibold ${selected ? 'text-brand' : 'text-ink'}`}>
          {team.teamName}
        </span>
        <span className="text-xs text-ink-tertiary">{team.agent_count}명</span>
      </div>
      <div className="flex gap-2 text-xs text-ink-secondary">
        <span>총 <strong className="text-ink">{team.total_calls}</strong></span>
        <span>발신 {team.outgoing}</span>
        <span>수신 {team.incoming}</span>
        <span className={team.missed > 0 ? 'text-negative' : ''}>부재 {team.missed}</span>
      </div>
      <div className="flex items-center gap-3 text-xs text-ink-tertiary mt-0.5">
        <span>통화시간 {formatDurationCompact(team.total_duration)}</span>
        {team.avg_score != null && (
          <span>
            AI점수{' '}
            <strong className={
              team.avg_score >= 7 ? 'text-positive' :
              team.avg_score <= 3 ? 'text-negative' : 'text-ink'
            }>
              {team.avg_score}
            </strong>
          </span>
        )}
      </div>
    </button>
  )
}

/* ─── Report Table Row ─── */
function ReportRow({ agent, rowNum }) {
  const score = agent.avg_score
  let scoreColor = 'text-ink-secondary'
  if (score != null) {
    if (score >= 7) scoreColor = 'text-positive'
    else if (score <= 3) scoreColor = 'text-negative'
  }

  return (
    <tr className="border-b border-line-light last:border-b-0 hover:bg-surface-panel transition-colors">
      <td className="px-2 py-1.5 text-center">
        <span className="text-xs text-ink-tertiary">{rowNum}</span>
      </td>
      <td className="px-2 py-1.5">
        <span className="text-xs font-medium text-ink">{agent.uploader_name || agent.uploader_phone}</span>
      </td>
      <td className="px-2 py-1.5">
        <span className="text-xs text-ink-secondary">{agent.team_name || '미지정'}</span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className="text-xs text-ink-secondary font-mono">
          {formatDurationCompact(agent.total_duration)}
        </span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className="text-xs font-semibold text-ink">{agent.total_calls}</span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className="text-xs text-ink-secondary">{agent.outgoing}</span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className="text-xs text-ink-secondary">{agent.incoming}</span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className={`text-xs ${agent.missed > 0 ? 'text-negative font-medium' : 'text-ink-secondary'}`}>
          {agent.missed}
        </span>
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className={`text-xs font-semibold ${scoreColor}`}>
          {score != null ? score : '-'}
        </span>
      </td>
    </tr>
  )
}
