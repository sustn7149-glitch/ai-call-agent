import { useState, useEffect, useCallback, useMemo } from 'react'
import useSocket from '../hooks/useSocket'
import { formatTime } from '../utils'
import { DirectionBadge, EmotionBadge, ScoreBadge, AiStatusBadge } from '../components/Badges'
import DetailModal from '../components/DetailModal'

export default function History() {
  const { socket } = useSocket()
  const [calls, setCalls] = useState([])
  const [selectedCall, setSelectedCall] = useState(null)

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [nameSearch, setNameSearch] = useState('')

  const fetchCalls = useCallback(async () => {
    try {
      const res = await fetch('/api/calls')
      setCalls(await res.json())
    } catch (err) {
      console.error('Failed to fetch calls:', err)
    }
  }, [])

  useEffect(() => {
    fetchCalls()
    const interval = setInterval(fetchCalls, 30000)

    socket.on('call-status', fetchCalls)
    socket.on('queue:job-completed', fetchCalls)
    socket.on('queue:job-added', fetchCalls)

    return () => {
      clearInterval(interval)
      socket.off('call-status', fetchCalls)
      socket.off('queue:job-completed', fetchCalls)
      socket.off('queue:job-added', fetchCalls)
    }
  }, [socket, fetchCalls])

  const handleSelectCall = async (call) => {
    try {
      const res = await fetch(`/api/calls/${call.id}`)
      setSelectedCall(await res.json())
    } catch {
      setSelectedCall(call)
    }
  }

  // Derive unique teams from data
  const teams = useMemo(() => {
    const set = new Set()
    calls.forEach(c => { if (c.team_name) set.add(c.team_name) })
    return Array.from(set).sort()
  }, [calls])

  // Client-side dedup + filtering
  const filtered = useMemo(() => {
    // Deduplicate by call id (prevent duplicate rows from backend/JOIN)
    const seen = new Set()
    return calls.filter(call => {
      if (seen.has(call.id)) return false
      seen.add(call.id)
      if (dateFrom && call.created_at && call.created_at < dateFrom) return false
      if (dateTo && call.created_at && call.created_at > dateTo + 'T23:59:59') return false
      if (teamFilter && call.team_name !== teamFilter) return false
      if (nameSearch) {
        const q = nameSearch.toLowerCase()
        const matchName = (call.uploader_name || '').toLowerCase().includes(q)
        const matchCustomer = (call.customer_name || '').toLowerCase().includes(q)
        const matchPhone = (call.phone_number || '').includes(q)
        if (!matchName && !matchCustomer && !matchPhone) return false
      }
      return true
    })
  }, [calls, dateFrom, dateTo, teamFilter, nameSearch])

  return (
    <div className="px-6 py-5 space-y-4">
      <h1 className="text-lg font-semibold text-ink">통화 이력</h1>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-surface border border-line rounded-lg px-4 py-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-tertiary">시작일</label>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="border border-line rounded px-2 py-1 text-sm text-ink bg-surface-page"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-tertiary">종료일</label>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="border border-line rounded px-2 py-1 text-sm text-ink bg-surface-page"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-tertiary">팀</label>
          <select
            value={teamFilter}
            onChange={e => setTeamFilter(e.target.value)}
            className="border border-line rounded px-2 py-1 text-sm text-ink bg-surface-page"
          >
            <option value="">전체</option>
            {teams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-ink-tertiary">검색</label>
          <input
            type="text"
            placeholder="이름 / 전화번호"
            value={nameSearch}
            onChange={e => setNameSearch(e.target.value)}
            className="border border-line rounded px-2 py-1 text-sm text-ink bg-surface-page w-40"
          />
        </div>
        {(dateFrom || dateTo || teamFilter || nameSearch) && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); setTeamFilter(''); setNameSearch('') }}
            className="text-xs text-brand hover:underline"
          >
            초기화
          </button>
        )}
      </div>

      {/* Call Table */}
      {filtered.length === 0 ? (
        <div className="bg-surface border border-line rounded-lg py-12 text-center">
          <p className="text-base text-ink-tertiary">통화 기록이 없습니다</p>
          <p className="text-sm text-ink-tertiary mt-1">새 통화가 들어오면 여기에 표시됩니다</p>
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-line-light">
            <h2 className="text-sm font-medium text-ink-secondary">
              상세 분석 <span className="text-ink-tertiary ml-1">{filtered.length}건</span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">담당자</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">시간</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">구분</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">고객명</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">전화번호</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">요약</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">감정</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">점수</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">상태</th>
                  <th className="px-4 py-2.5 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((call) => (
                  <tr
                    key={call.id}
                    onClick={() => handleSelectCall(call)}
                    className="border-b border-line-light last:border-b-0 hover:bg-surface-panel cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2.5 text-sm font-medium text-ink">
                      {call.uploader_name || ''}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-ink-secondary whitespace-nowrap">
                      {formatTime(call.created_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <DirectionBadge direction={call.direction} />
                    </td>
                    <td className="px-4 py-2.5 text-sm text-ink">
                      {call.customer_name || ''}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-ink-secondary font-mono">
                      {call.phone_number || ''}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-ink-secondary max-w-[260px] truncate">
                      {call.ai_summary || call.summary || ''}
                    </td>
                    <td className="px-4 py-2.5">
                      <EmotionBadge emotion={call.ai_emotion || call.sentiment} />
                    </td>
                    <td className="px-4 py-2.5">
                      <ScoreBadge score={call.ai_score} />
                    </td>
                    <td className="px-4 py-2.5">
                      <AiStatusBadge status={call.ai_status} analyzed={call.ai_analyzed} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-sm text-brand font-medium">보기</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedCall && (
        <DetailModal call={selectedCall} onClose={() => setSelectedCall(null)} />
      )}
    </div>
  )
}
