export function formatTime(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleString('ko-KR', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true
    })
  } catch { return dateStr }
}

export function formatSeconds(sec) {
  if (!sec) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function lastSeenText(agent) {
  if (!agent.lastSeen) return ''
  const diff = (Date.now() - new Date(agent.lastSeen).getTime()) / 60000
  if (diff < 1) return '방금 전'
  if (diff < 60) return `${Math.floor(diff)}분 전`
  return `${Math.floor(diff / 60)}시간 전`
}
