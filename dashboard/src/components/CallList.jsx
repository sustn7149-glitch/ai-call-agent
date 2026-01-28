import StatusBadge from './StatusBadge'

export default function CallList({ calls, selectedId, onSelect }) {
  if (!calls.length) {
    return (
      <div className="p-6 text-center text-gray-400">
        <p className="text-lg mb-2">통화 기록 없음</p>
        <p className="text-sm">새 통화가 들어오면 여기에 표시됩니다</p>
      </div>
    )
  }

  return (
    <div>
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
          통화 목록 ({calls.length})
        </h2>
      </div>
      <ul>
        {calls.map((call) => (
          <li
            key={call.id}
            onClick={() => onSelect(call)}
            className={`px-4 py-3 border-b border-gray-50 cursor-pointer transition-colors hover:bg-blue-50 ${
              selectedId === call.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-gray-800">
                {call.phone_number || 'UNKNOWN'}
              </span>
              <StatusBadge status={call.status} analyzed={call.ai_analyzed} />
            </div>
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>{call.direction === 'IN' ? '수신' : '발신'}</span>
              <span>{formatTime(call.created_at)}</span>
            </div>
            {call.ai_analyzed === 1 && call.summary && (
              <p className="mt-1 text-xs text-gray-400 truncate">{call.summary}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatTime(dateStr) {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    return date.toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return dateStr
  }
}
