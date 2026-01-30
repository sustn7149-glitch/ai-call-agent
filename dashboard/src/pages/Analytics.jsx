import { useState, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'

const CHART_COLORS = {
  brand: '#3366FF',
  green: '#22C55E',
  red: '#EF4444',
  gray: '#9CA3AF',
  line: '#D1D5DB',
}

const TH = 'border border-gray-300 text-[12px] font-bold text-center text-gray-700 px-2 whitespace-nowrap'
const TD = 'border border-gray-300 text-[12px] text-center text-gray-700 px-2'
const TH_STYLE = { background: '#ECEBFF', height: '26px' }

export default function Analytics() {
  const [daily, setDaily] = useState([])
  const [team, setTeam] = useState([])
  const [direction, setDirection] = useState([])

  useEffect(() => {
    fetch('/api/analytics/daily').then(r => r.json()).then(setDaily).catch(() => {})
    fetch('/api/analytics/team').then(r => r.json()).then(setTeam).catch(() => {})
    fetch('/api/analytics/direction').then(r => r.json()).then(d => {
      setDirection(d.map(item => ({
        name: item.direction === 'IN' ? '수신' : item.direction === 'OUT' ? '발신' : '기타',
        value: item.count,
      })))
    }).catch(() => {})
  }, [])

  const pieColors = [CHART_COLORS.red, CHART_COLORS.green, CHART_COLORS.gray]

  return (
    <div className="px-3 py-3" style={{ fontFamily: 'Pretendard, -apple-system, sans-serif' }}>

      {/* ── 타이틀 바 ── */}
      <div className="flex items-center mb-2 bg-gray-50 border border-gray-300 px-3 py-1.5">
        <span className="text-[12px] font-bold text-gray-700">통계 분석</span>
      </div>

      {/* ── 일별 통화량 차트 ── */}
      <div className="border border-gray-300 mb-2">
        <div className="px-3 py-1.5" style={{ background: '#ECEBFF' }}>
          <span className="text-[12px] font-bold text-gray-700">최근 7일 통화량 추이</span>
        </div>
        <div className="px-3 py-3 bg-white" style={{ height: '260px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.line} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: '12px' }} />
              <Line type="monotone" dataKey="count" name="통화 건수"
                stroke={CHART_COLORS.brand} strokeWidth={2}
                dot={{ r: 3, fill: CHART_COLORS.brand }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── 하단 2열: 팀별 + 수신/발신 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">

        {/* 팀별 통화 건수 */}
        <div className="border border-gray-300">
          <div className="px-3 py-1.5" style={{ background: '#ECEBFF' }}>
            <span className="text-[12px] font-bold text-gray-700">팀별 통화 건수</span>
          </div>
          <div className="bg-white">
            <div className="px-3 py-3" style={{ height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={team}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.line} />
                  <XAxis dataKey="team" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="count" name="건수" fill={CHART_COLORS.brand} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {/* 팀별 데이터 테이블 */}
            {team.length > 0 && (
              <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th className={TH} style={TH_STYLE}>팀</th>
                    <th className={TH} style={TH_STYLE}>건수</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((t, i) => (
                    <tr key={i} style={{ height: '26px' }}>
                      <td className={`${TD} font-medium`}>{t.team || '미지정'}</td>
                      <td className={`${TD} font-bold`}>{t.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* 수신/발신 비율 */}
        <div className="border border-gray-300">
          <div className="px-3 py-1.5" style={{ background: '#ECEBFF' }}>
            <span className="text-[12px] font-bold text-gray-700">수신 / 발신 비율</span>
          </div>
          <div className="bg-white">
            <div className="px-3 py-3" style={{ height: '220px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={direction} cx="50%" cy="50%" outerRadius={80}
                    dataKey="value" nameKey="name"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={{ stroke: '#9CA3AF', strokeWidth: 1 }}>
                    {direction.map((_, idx) => (
                      <Cell key={idx} fill={pieColors[idx % pieColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* 비율 테이블 */}
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
