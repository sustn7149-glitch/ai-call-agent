import { useState, useEffect, useCallback } from 'react'
import {
  ComposedChart, Line, Bar, PieChart, Pie, Cell, BarChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'

const CHART_COLORS = {
  brand: '#3366FF',
  green: '#22C55E',
  red: '#EF4444',
  orange: '#F59E0B',
  gray: '#9CA3AF',
  line: '#D1D5DB',
}

const TH = 'border border-gray-300 text-[12px] font-bold text-center text-gray-700 px-2 whitespace-nowrap'
const TD = 'border border-gray-300 text-[12px] text-center text-gray-700 px-2'
const TH_STYLE = { background: '#ECEBFF', height: '26px' }

// 날짜 헬퍼
const toDateStr = (d) => d.toISOString().split('T')[0]
const getKST = () => {
  const now = new Date()
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
}
const getToday = () => toDateStr(getKST())

const DATE_PRESETS = [
  { label: '오늘', getValue: () => { const t = getToday(); return [t, t] } },
  { label: '이번주', getValue: () => {
    const kst = getKST()
    const day = kst.getDay()
    const monday = new Date(kst)
    monday.setDate(kst.getDate() - (day === 0 ? 6 : day - 1))
    return [toDateStr(monday), getToday()]
  }},
  { label: '이번달', getValue: () => {
    const kst = getKST()
    const firstDay = new Date(kst.getFullYear(), kst.getMonth(), 1)
    return [toDateStr(firstDay), getToday()]
  }},
  { label: '최근 30일', getValue: () => {
    const kst = getKST()
    const ago = new Date(kst)
    ago.setDate(kst.getDate() - 29)
    return [toDateStr(ago), getToday()]
  }},
]

const fmtDurHM = (sec) => {
  if (!sec) return '-'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}시간 ${m}분`
  return `${m}분`
}

export default function Analytics() {
  const [daily, setDaily] = useState([])
  const [team, setTeam] = useState([])
  const [direction, setDirection] = useState([])
  const [activePreset, setActivePreset] = useState(3) // 최근 30일
  const [startDate, setStartDate] = useState(() => DATE_PRESETS[3].getValue()[0])
  const [endDate, setEndDate] = useState(() => DATE_PRESETS[3].getValue()[1])

  const fetchData = useCallback(() => {
    const params = `startDate=${startDate}&endDate=${endDate}`
    fetch(`/api/analytics/daily?${params}`).then(r => r.json()).then(setDaily).catch(() => {})
    fetch(`/api/analytics/team?${params}`).then(r => r.json()).then(setTeam).catch(() => {})
    fetch('/api/analytics/direction').then(r => r.json()).then(d => {
      setDirection(
        d.filter(item => item.direction === 'IN' || item.direction === 'OUT')
         .map(item => ({
           name: item.direction === 'IN' ? '수신' : '발신',
           value: item.count,
           direction: item.direction,
         }))
      )
    }).catch(() => {})
  }, [startDate, endDate])

  useEffect(() => { fetchData() }, [fetchData])

  const handlePreset = (idx) => {
    const [s, e] = DATE_PRESETS[idx].getValue()
    setStartDate(s)
    setEndDate(e)
    setActivePreset(idx)
  }

  // 요약 통계 계산
  const summary = (() => {
    const totalCalls = daily.reduce((s, d) => s + (d.count || 0), 0)
    const totalDuration = daily.reduce((s, d) => s + (d.total_duration || 0), 0)
    const totalIncoming = daily.reduce((s, d) => s + (d.incoming || 0), 0)
    const totalOutgoing = daily.reduce((s, d) => s + (d.outgoing || 0), 0)
    const scoredDays = daily.filter(d => d.avg_score != null && d.avg_score > 0)
    const avgScore = scoredDays.length > 0
      ? Math.round((scoredDays.reduce((s, d) => s + d.avg_score, 0) / scoredDays.length) * 10) / 10
      : null
    const inOutRatio = totalCalls > 0
      ? `${Math.round((totalIncoming / totalCalls) * 100)}:${Math.round((totalOutgoing / totalCalls) * 100)}`
      : '-'
    return { totalCalls, totalDuration, avgScore, totalIncoming, totalOutgoing, inOutRatio }
  })()

  // 일별 차트 데이터: 날짜 포맷 간소화 (MM-DD)
  const dailyChartData = daily.map(d => ({
    ...d,
    label: d.date ? d.date.slice(5) : d.date,
    durationMin: Math.round((d.total_duration || 0) / 60),
  }))

  const directionColorMap = { '수신': CHART_COLORS.red, '발신': CHART_COLORS.green }

  return (
    <div className="px-3 py-3" style={{ fontFamily: 'Pretendard, -apple-system, sans-serif' }}>

      {/* ── 타이틀 + 날짜 필터 ── */}
      <div className="flex items-center gap-2 mb-2 bg-gray-50 border border-gray-300 px-3 py-1.5">
        <span className="text-[12px] font-bold text-gray-700">통계 분석</span>
        <div className="flex items-center gap-1 ml-4">
          {DATE_PRESETS.map((p, idx) => (
            <button key={idx} onClick={() => handlePreset(idx)}
              className={`px-2 py-0.5 text-[11px] border ${
                activePreset === idx
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-2">
          <input type="date" value={startDate}
            onChange={e => { setStartDate(e.target.value); setActivePreset(-1) }}
            className="border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 bg-white" />
          <span className="text-[11px] text-gray-400">~</span>
          <input type="date" value={endDate}
            onChange={e => { setEndDate(e.target.value); setActivePreset(-1) }}
            className="border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-700 bg-white" />
        </div>
      </div>

      {/* ── 요약 카드 ── */}
      <div className="flex items-stretch gap-0 mb-2">
        <div className="border border-gray-300 px-4 py-2 bg-blue-50 flex-1 text-center">
          <div className="text-[11px] text-blue-600">총 통화 건수</div>
          <div className="text-[20px] font-bold text-blue-700">{summary.totalCalls}<span className="text-[11px] font-normal text-gray-400">건</span></div>
        </div>
        <div className="border border-gray-300 border-l-0 px-4 py-2 bg-green-50 flex-1 text-center">
          <div className="text-[11px] text-green-600">총 통화시간</div>
          <div className="text-[20px] font-bold text-green-700">{fmtDurHM(summary.totalDuration)}</div>
        </div>
        <div className="border border-gray-300 border-l-0 px-4 py-2 bg-purple-50 flex-1 text-center">
          <div className="text-[11px] text-purple-600">평균 점수</div>
          <div className="text-[20px] font-bold text-purple-700">{summary.avgScore != null ? summary.avgScore : '-'}<span className="text-[11px] font-normal text-gray-400">{summary.avgScore != null ? '점' : ''}</span></div>
        </div>
        <div className="border border-gray-300 border-l-0 px-4 py-2 bg-orange-50 flex-1 text-center">
          <div className="text-[11px] text-orange-600">수신 / 발신</div>
          <div className="text-[16px] font-bold text-orange-700">
            <span className="text-red-600">{summary.totalIncoming}</span>
            <span className="text-gray-400 mx-1">/</span>
            <span className="text-green-600">{summary.totalOutgoing}</span>
          </div>
          <div className="text-[10px] text-gray-400">{summary.inOutRatio}</div>
        </div>
      </div>

      {/* ── 일별 통화량 + 통화시간 듀얼 축 차트 ── */}
      <div className="border border-gray-300 mb-2">
        <div className="px-3 py-1.5" style={{ background: '#ECEBFF' }}>
          <span className="text-[12px] font-bold text-gray-700">일별 통화량 추이</span>
          <span className="text-[10px] text-gray-500 ml-2">(막대: 통화시간(분), 선: 통화건수)</span>
        </div>
        <div className="px-3 py-3 bg-white" style={{ height: '360px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dailyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.line} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#6B7280' }} allowDecimals={false}
                label={{ value: '건수', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#6B7280' } }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#9CA3AF' }}
                label={{ value: '분', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9CA3AF' } }} />
              <Tooltip contentStyle={{ fontSize: '12px' }}
                formatter={(value, name) => {
                  if (name === '통화시간') return [`${value}분`, name]
                  return [value, name]
                }} />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Bar yAxisId="right" dataKey="durationMin" name="통화시간" fill={CHART_COLORS.green} opacity={0.3} radius={[2, 2, 0, 0]} />
              <Line yAxisId="left" type="monotone" dataKey="count" name="통화건수"
                stroke={CHART_COLORS.brand} strokeWidth={2}
                dot={{ r: 3, fill: CHART_COLORS.brand }} activeDot={{ r: 5 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── 하단 2열: 팀별 + 수신/발신 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">

        {/* 팀별 통화 건수 + 통화시간 */}
        <div className="border border-gray-300">
          <div className="px-3 py-1.5" style={{ background: '#ECEBFF' }}>
            <span className="text-[12px] font-bold text-gray-700">팀별 통화 현황</span>
          </div>
          <div className="bg-white">
            <div className="px-3 py-3" style={{ height: '360px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={team}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.line} />
                  <XAxis dataKey="team" tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: '12px' }}
                    formatter={(value, name) => {
                      if (name === '통화시간') return [fmtDurHM(value), name]
                      return [value, name]
                    }} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="count" name="건수" fill={CHART_COLORS.brand} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="total_duration" name="통화시간" fill={CHART_COLORS.green} opacity={0.5} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {team.length > 0 && (
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th className={TH} style={TH_STYLE}>팀</th>
                    <th className={TH} style={TH_STYLE}>건수</th>
                    <th className={TH} style={TH_STYLE}>통화시간</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((t, i) => (
                    <tr key={i} style={{ height: '26px' }}>
                      <td className={`${TD} font-medium`}>{t.team || '미지정'}</td>
                      <td className={`${TD} font-bold`}>{t.count}</td>
                      <td className={`${TD} text-gray-600`}>{fmtDurHM(t.total_duration)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 수신/발신 비율 - 도넛 차트 */}
        <div className="border border-gray-300">
          <div className="px-3 py-1.5" style={{ background: '#ECEBFF' }}>
            <span className="text-[12px] font-bold text-gray-700">수신 / 발신 비율</span>
          </div>
          <div className="bg-white">
            <div className="px-3 py-3 flex items-center justify-center" style={{ height: '360px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={direction} cx="50%" cy="50%"
                    innerRadius={60} outerRadius={120}
                    dataKey="value" nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ stroke: '#9CA3AF', strokeWidth: 1 }}>
                    {direction.map((entry, idx) => (
                      <Cell key={idx} fill={directionColorMap[entry.name] || CHART_COLORS.gray} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {direction.length > 0 && (
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th className={TH} style={TH_STYLE}>구분</th>
                    <th className={TH} style={TH_STYLE}>건수</th>
                    <th className={TH} style={TH_STYLE}>비율</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const total = direction.reduce((s, d) => s + d.value, 0)
                    return direction.map((d, i) => (
                      <tr key={i} style={{ height: '26px' }}>
                        <td className={`${TD} font-medium`}>
                          <span className={d.name === '수신' ? 'text-red-600' : d.name === '발신' ? 'text-green-600' : 'text-gray-500'}>
                            {d.name}
                          </span>
                        </td>
                        <td className={`${TD} font-bold`}>{d.value}</td>
                        <td className={TD}>{total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%</td>
                      </tr>
                    ))
                  })()}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
