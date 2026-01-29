import { useState, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'

const COLORS = {
  brand: '#3366FF',
  tertiary: '#767676',
  line: '#E5E5EC',
  positive: '#2ECC71',
  negative: '#E74C3C',
}

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

  const pieColors = [COLORS.brand, COLORS.tertiary, COLORS.line]

  return (
    <div className="px-6 py-5 space-y-5">
      <h1 className="text-lg font-semibold text-ink">통계 분석</h1>

      {/* Daily line chart */}
      <div className="bg-surface border border-line rounded-lg px-5 py-4">
        <h2 className="text-sm font-medium text-ink-secondary mb-4">최근 7일 통화량 추이</h2>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: COLORS.tertiary }} />
              <YAxis tick={{ fontSize: 12, fill: COLORS.tertiary }} allowDecimals={false} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="count"
                name="통화 건수"
                stroke={COLORS.brand}
                strokeWidth={2}
                dot={{ r: 4, fill: COLORS.brand }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Team bar chart */}
        <div className="bg-surface border border-line rounded-lg px-5 py-4">
          <h2 className="text-sm font-medium text-ink-secondary mb-4">팀별 통화 건수</h2>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={team}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.line} />
                <XAxis dataKey="team" tick={{ fontSize: 12, fill: COLORS.tertiary }} />
                <YAxis tick={{ fontSize: 12, fill: COLORS.tertiary }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" name="건수" fill={COLORS.brand} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Direction pie chart */}
        <div className="bg-surface border border-line rounded-lg px-5 py-4">
          <h2 className="text-sm font-medium text-ink-secondary mb-4">수신 / 발신 비율</h2>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={direction}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {direction.map((_, idx) => (
                    <Cell key={idx} fill={pieColors[idx % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
