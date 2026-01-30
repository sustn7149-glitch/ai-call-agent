import { useState, useEffect, useCallback, useMemo } from 'react'
import useSocket from '../hooks/useSocket'
import { formatPhoneNumber } from '../utils'
import DetailModal from '../components/DetailModal'

/* ── 표시용 날짜 선택: start_time(KST) 우선, 없으면 created_at(UTC→KST 보정) ── */
function getDisplayDate(call) {
  if (call.start_time) return call.start_time
  if (call.created_at) {
    // created_at is UTC from SQLite CURRENT_TIMESTAMP, append 'Z' so JS parses as UTC
    const utcStr = call.created_at.endsWith('Z') ? call.created_at : call.created_at + 'Z'
    const d = new Date(utcStr)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  return null
}

/* ── 경과 시간 계산 (텍스트 + 색상) ── */
function getElapsed(dateStr) {
  if (!dateStr) return null
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime()
    if (diffMs < 0) return null
    const sec = Math.floor(diffMs / 1000)
    if (sec < 60) return { text: '방금', color: 'text-rose-500' }
    const min = Math.floor(sec / 60)
    if (min < 60) return { text: `${min}분 전`, color: 'text-[#fa00c8]' }
    const hr = Math.floor(min / 60)
    if (hr < 24) return { text: `${hr}시간 전`, color: 'text-[#0000ff]' }
    const day = Math.floor(hr / 24)
    if (day < 30) return { text: `${day}일 전`, color: 'text-[#0000ff]' }
    return { text: `${Math.floor(day / 30)}개월 전`, color: 'text-[#0000ff]' }
  } catch { return null }
}

/* ── 날짜 포맷 (yyyy-MM-dd HH:mm:ss) ── */
function formatFullDate(dateStr) {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch { return dateStr }
}

/* ── 통화시간 포맷 ── */
function fmtDuration(sec) {
  if (!sec || sec === 0) return '-'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}분 ${s}초` : `${s}초`
}

/* ── 감정 텍스트/색상 ── */
function emotionText(e) {
  if (!e) return '-'
  const l = e.toLowerCase()
  if (l.includes('positive')) return '긍정'
  if (l.includes('negative')) return '부정'
  return '중립'
}
function emotionColor(e) {
  if (!e) return 'text-gray-400'
  const l = e.toLowerCase()
  if (l.includes('positive')) return 'text-blue-600'
  if (l.includes('negative')) return 'text-red-600'
  return 'text-gray-500'
}

/* ── 점수 색상 ── */
function scoreColor(s) {
  if (s == null) return 'text-gray-400'
  if (s >= 7) return 'text-blue-700 font-bold'
  if (s >= 4) return 'text-gray-700'
  return 'text-red-600 font-bold'
}

/* ── 결과(Outcome) 뱃지 파싱 ── */
function parseOutcome(outcome) {
  if (!outcome) return null
  const str = outcome.trim()
  if (str.startsWith('성공')) {
    const reason = str.replace(/^성공[:\s：]*/, '').trim()
    return { type: 'success', label: '성공', reason }
  }
  if (str.startsWith('실패')) {
    const reason = str.replace(/^실패[:\s：]*/, '').trim()
    return { type: 'fail', label: '실패', reason }
  }
  if (str.startsWith('보류')) {
    const reason = str.replace(/^보류[:\s：]*/, '').trim()
    return { type: 'hold', label: '보류', reason }
  }
  return { type: 'unknown', label: '', reason: str }
}

/* ══════════════════════════════════════════ */
/*            History (ERP Style)            */
/* ══════════════════════════════════════════ */

const TH = 'border border-gray-300 text-[12px] font-bold text-center text-gray-700 px-2 whitespace-nowrap'
const TD = 'border border-gray-300 text-[12px] text-center text-gray-700 px-2'
const TH_STYLE = { background: '#ECEBFF', height: '26px', position: 'sticky', top: 0, zIndex: 10 }

const PAGE_OPTIONS = [20, 50, 100, 200, 500, 1000]

/* colgroup 너비: No 녹취일자 팀 담당자 구분 고객명 전화번호 통화시간 요약(auto) 결과 감정 점수 재생 = 13열 */
const COL_WIDTHS = ['36px', '170px', '60px', '64px', '48px', '64px', '110px', '68px', 'auto', '96px', '48px', '44px', '56px']

export default function History() {
  const { socket } = useSocket()
  const [calls, setCalls] = useState([])
  const [selectedCall, setSelectedCall] = useState(null)
  const [, setTick] = useState(0)

  /* Filters */
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [nameSearch, setNameSearch] = useState('')

  /* Pagination */
  const [pageSize, setPageSize] = useState(50)
  const [currentPage, setCurrentPage] = useState(1)

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
    const dataInterval = setInterval(fetchCalls, 30000)
    const tickInterval = setInterval(() => setTick(t => t + 1), 60000)

    socket.on('call-status', fetchCalls)
    socket.on('queue:job-completed', fetchCalls)
    socket.on('queue:job-added', fetchCalls)

    return () => {
      clearInterval(dataInterval)
      clearInterval(tickInterval)
      socket.off('call-status', fetchCalls)
      socket.off('queue:job-completed', fetchCalls)
      socket.off('queue:job-added', fetchCalls)
    }
  }, [socket, fetchCalls])

  const handleSelectCall = async (call) => {
    try {
      const res = await fetch(`/api/calls/${call.id}`)
      setSelectedCall(await res.json())
    } catch { setSelectedCall(call) }
  }

  const handlePlay = (e, call) => {
    e.stopPropagation()
    handleSelectCall(call)
  }

  /* 팀 목록 (필터용) */
  const teams = useMemo(() => {
    const s = new Set()
    calls.forEach(c => { if (c.team_name) s.add(c.team_name) })
    return Array.from(s).sort()
  }, [calls])

  /* 필터링 + UNKNOWN 제거 + 중복 제거 */
  const filtered = useMemo(() => {
    const seen = new Set()
    return calls.filter(call => {
      if (seen.has(call.id)) return false
      seen.add(call.id)
      const cn = (call.customer_name || '').trim().toUpperCase()
      const pn = (call.phone_number || '').trim().toUpperCase()
      if (cn === 'UNKNOWN' || pn === 'UNKNOWN') return false
      const callDate = call.start_time || call.created_at || ''
      if (dateFrom && callDate && callDate < dateFrom) return false
      if (dateTo && callDate && callDate > dateTo + 'T23:59:59') return false
      if (teamFilter && call.team_name !== teamFilter) return false
      if (nameSearch) {
        const q = nameSearch.toLowerCase()
        const mN = (call.uploader_name || '').toLowerCase().includes(q)
        const mC = (call.customer_name || '').toLowerCase().includes(q)
        const mP = (call.phone_number || '').includes(q)
        if (!mN && !mC && !mP) return false
      }
      return true
    })
  }, [calls, dateFrom, dateTo, teamFilter, nameSearch])

  /* 전화번호별 통화 카운트 */
  const callCountMap = useMemo(() => {
    const map = {}
    filtered.forEach(c => {
      const pn = c.phone_number || ''
      if (pn) map[pn] = (map[pn] || 0) + 1
    })
    return map
  }, [filtered])

  /* 페이지네이션 계산 */
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const pagedData = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, safePage, pageSize])

  /* 필터 변경 시 페이지 리셋 */
  useEffect(() => { setCurrentPage(1) }, [dateFrom, dateTo, teamFilter, nameSearch, pageSize])

  /* 페이지 번호 목록 생성 */
  const pageNumbers = useMemo(() => {
    const pages = []
    const maxVisible = 7
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      pages.push(1)
      let start = Math.max(2, safePage - 2)
      let end = Math.min(totalPages - 1, safePage + 2)
      if (safePage <= 3) { start = 2; end = Math.min(6, totalPages - 1) }
      if (safePage >= totalPages - 2) { start = Math.max(2, totalPages - 5); end = totalPages - 1 }
      if (start > 2) pages.push('...')
      for (let i = start; i <= end; i++) pages.push(i)
      if (end < totalPages - 1) pages.push('...')
      pages.push(totalPages)
    }
    return pages
  }, [totalPages, safePage])

  return (
    <div className="px-3 py-3 flex flex-col" style={{ fontFamily: 'Pretendard, -apple-system, sans-serif', height: 'calc(100vh - 48px)' }}>

      {/* ── 필터 바 ── */}
      <div className="flex flex-wrap items-center gap-2 mb-2 bg-gray-50 border border-gray-300 px-3 py-1.5 shrink-0">
        <span className="text-[12px] font-bold text-gray-700 mr-1">필터</span>

        <div className="flex items-center gap-1">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 bg-white" />
          <span className="text-[11px] text-gray-400">~</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 bg-white" />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-gray-500">팀</label>
          <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}
            className="border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 bg-white">
            <option value="">전체</option>
            {teams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-gray-500">검색</label>
          <input type="text" placeholder="이름/번호" value={nameSearch} onChange={e => setNameSearch(e.target.value)}
            className="border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 bg-white w-28" />
        </div>

        {(dateFrom || dateTo || teamFilter || nameSearch) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); setTeamFilter(''); setNameSearch('') }}
            className="text-[11px] text-blue-600 hover:underline ml-1">초기화</button>
        )}
        <span className="text-[11px] text-gray-400 ml-auto">총 {filtered.length}건</span>
      </div>

      {/* ── 테이블 (스크롤 영역) ── */}
      <div className="overflow-auto flex-1 border border-gray-300">
        <table className="w-full table-fixed" style={{ borderCollapse: 'collapse' }}>
          <colgroup>
            {COL_WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className={TH} style={TH_STYLE}>No.</th>
              <th className={TH} style={TH_STYLE}>녹취일자</th>
              <th className={TH} style={TH_STYLE}>팀</th>
              <th className={TH} style={TH_STYLE}>담당자</th>
              <th className={TH} style={TH_STYLE}>구분</th>
              <th className={TH} style={TH_STYLE}>고객명</th>
              <th className={TH} style={TH_STYLE}>전화번호</th>
              <th className={TH} style={TH_STYLE}>통화시간</th>
              <th className={TH} style={TH_STYLE}>요약</th>
              <th className={TH} style={TH_STYLE}>결과</th>
              <th className={TH} style={TH_STYLE}>감정</th>
              <th className={TH} style={TH_STYLE}>점수</th>
              <th className={TH} style={TH_STYLE}>재생</th>
            </tr>
          </thead>
          <tbody>
            {pagedData.length === 0 ? (
              <tr>
                <td colSpan={13} className="border border-gray-300 text-center text-[12px] text-gray-400 py-8">
                  통화 기록이 없습니다
                </td>
              </tr>
            ) : (
              pagedData.map((call, idx) => {
                const displayDate = getDisplayDate(call)
                const elapsed = getElapsed(displayDate)
                const fullDate = formatFullDate(displayDate)
                const summary = call.ai_summary || call.summary || ''
                const emotion = call.ai_emotion || call.sentiment
                const hasRec = !!call.recording_path
                const globalIdx = (safePage - 1) * pageSize + idx
                const isLowScore = call.ai_score != null && call.ai_score < 3
                const outcome = parseOutcome(call.outcome)

                return (
                  <tr key={call.id}
                    onClick={() => handleSelectCall(call)}
                    className={`cursor-pointer ${isLowScore ? 'bg-red-100 hover:bg-red-200' : 'hover:bg-blue-50'}`}
                    style={{ height: '28px' }}>

                    {/* No. (역순) */}
                    <td className={`${TD} text-gray-500`}>{filtered.length - globalIdx}</td>

                    {/* 녹취일자 + 경과시간 */}
                    <td className={`${TD} whitespace-nowrap overflow-hidden`}>
                      {elapsed && <span className={`text-[8px] font-light ${elapsed.color} mr-1`}>{elapsed.text}</span>}
                      <span className="text-gray-600 text-[11px]">{fullDate}</span>
                    </td>

                    {/* 팀 */}
                    <td className={`${TD} truncate`} title={call.team_name || ''}>{call.team_name || '-'}</td>

                    {/* 담당자 */}
                    <td className={`${TD} font-medium truncate`} title={call.uploader_name || ''}>{call.uploader_name || '-'}</td>

                    {/* 구분 */}
                    <td className={TD}>
                      <span className={
                        call.direction === 'OUT'
                          ? 'text-green-600 bg-green-50 px-1 py-0.5 rounded-sm text-[11px]'
                          : 'text-red-600 bg-red-50 px-1 py-0.5 rounded-sm text-[11px]'
                      }>
                        {call.direction === 'OUT' ? '발신' : '수신'}
                      </span>
                    </td>

                    {/* 고객명 */}
                    <td className={`${TD} truncate`} title={call.customer_name || ''}>{call.customer_name || '-'}</td>

                    {/* 전화번호 + 통화 카운트 */}
                    <td className={`${TD} font-mono text-gray-600 text-[10px]`}>
                      {call.phone_number ? (
                        <>
                          {formatPhoneNumber(call.phone_number)}
                          {callCountMap[call.phone_number] > 1 && (
                            <span className="text-[8px] text-ink-tertiary ml-0.5">({callCountMap[call.phone_number]})</span>
                          )}
                        </>
                      ) : '-'}
                    </td>

                    {/* 통화시간 */}
                    <td className={`${TD} text-gray-600 whitespace-nowrap`}>{fmtDuration(call.duration)}</td>

                    {/* 요약 (넓게, truncate + title) */}
                    <td className={`${TD} text-left truncate text-gray-600`} title={summary}>
                      {summary || '-'}
                    </td>

                    {/* 결과 (Badge) */}
                    <td className={`${TD} px-1`}>
                      {outcome ? (
                        <div className="flex flex-col items-center leading-tight" title={call.outcome}>
                          {outcome.type === 'success' && (
                            <>
                              <span className="bg-blue-100 text-blue-700 font-bold text-[10px] px-1.5 py-0.5 rounded-sm">
                                {outcome.label}
                              </span>
                              {outcome.reason && (
                                <span className="text-[9px] text-blue-600 mt-0.5 truncate max-w-full">
                                  {outcome.reason}
                                </span>
                              )}
                            </>
                          )}
                          {outcome.type === 'fail' && (
                            <>
                              <span className="bg-gray-100 text-gray-600 font-medium text-[10px] px-1.5 py-0.5 rounded-sm">
                                {outcome.label}
                              </span>
                              {outcome.reason && (
                                <span className="text-[9px] text-gray-500 mt-0.5 truncate max-w-full font-medium">
                                  {outcome.reason}
                                </span>
                              )}
                            </>
                          )}
                          {outcome.type === 'hold' && (
                            <span className="bg-yellow-50 text-yellow-600 font-medium text-[10px] px-1.5 py-0.5 rounded-sm">
                              보류
                            </span>
                          )}
                          {outcome.type === 'unknown' && (
                            <span className="text-[10px] text-gray-400 truncate max-w-full">
                              {outcome.reason}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-300 text-[11px]">-</span>
                      )}
                    </td>

                    {/* 감정 */}
                    <td className={`${TD} font-medium ${emotionColor(emotion)}`}>{emotionText(emotion)}</td>

                    {/* 점수 */}
                    <td className={`${TD} ${scoreColor(call.ai_score)}`}>
                      {call.ai_score != null ? call.ai_score : '-'}
                    </td>

                    {/* 재생 버튼 */}
                    <td className="border border-gray-300 text-center px-1">
                      {hasRec ? (
                        <button onClick={e => handlePlay(e, call)}
                          className="bg-blue-600 text-white px-1.5 py-0.5 rounded-sm text-[11px] hover:bg-blue-700 whitespace-nowrap">
                          ▶ 재생
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-300">-</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── 페이지네이션 바 ── */}
      <div className="flex items-center justify-end gap-3 mt-1.5 px-1 shrink-0">
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-gray-500">표시</label>
          <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
            className="border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 bg-white">
            {PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}개</option>)}
          </select>
        </div>

        <div className="flex items-center gap-0.5">
          <button onClick={() => setCurrentPage(1)} disabled={safePage <= 1}
            className="px-1.5 py-0.5 text-[11px] border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-default">
            ≪
          </button>
          <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
            className="px-1.5 py-0.5 text-[11px] border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-default">
            ＜
          </button>

          {pageNumbers.map((p, i) =>
            p === '...' ? (
              <span key={`dots-${i}`} className="px-1 text-[11px] text-gray-400">...</span>
            ) : (
              <button key={p} onClick={() => setCurrentPage(p)}
                className={`px-2 py-0.5 text-[11px] border border-gray-300 ${
                  p === safePage ? 'bg-blue-600 text-white font-bold' : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}>
                {p}
              </button>
            )
          )}

          <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
            className="px-1.5 py-0.5 text-[11px] border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-default">
            ＞
          </button>
          <button onClick={() => setCurrentPage(totalPages)} disabled={safePage >= totalPages}
            className="px-1.5 py-0.5 text-[11px] border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-default">
            ≫
          </button>
        </div>

        <span className="text-[11px] text-gray-400">
          {safePage}/{totalPages} 페이지
        </span>
      </div>

      {/* ── 상세 모달 ── */}
      {selectedCall && (
        <DetailModal call={selectedCall} onClose={() => setSelectedCall(null)} />
      )}
    </div>
  )
}
