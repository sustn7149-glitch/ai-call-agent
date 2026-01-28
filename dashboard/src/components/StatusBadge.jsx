export default function StatusBadge({ status, analyzed }) {
  if (analyzed === 1) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        분석완료
      </span>
    )
  }

  const config = {
    RINGING: { color: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-500', label: '벨울림' },
    OFFHOOK: { color: 'bg-blue-100 text-blue-800', dot: 'bg-blue-500', label: '통화중' },
    IDLE: { color: 'bg-gray-100 text-gray-800', dot: 'bg-gray-500', label: '종료' },
    COMPLETED: { color: 'bg-purple-100 text-purple-800', dot: 'bg-purple-500', label: '업로드됨' },
  }

  const c = config[status] || config.IDLE

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  )
}
