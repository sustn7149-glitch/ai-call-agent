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

export function formatPhoneNumber(value) {
  if (!value) return value
  if (value.includes('-')) return value
  const clean = value.replace(/[^0-9]/g, '')
  if (clean.startsWith('82')) {
    const local = '0' + clean.slice(2)
    return formatPhoneNumber(local)
  }
  if (clean.length === 11) return clean.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3')
  if (clean.startsWith('02') && clean.length === 10) return clean.replace(/(\d{2})(\d{4})(\d{4})/, '$1-$2-$3')
  if (clean.startsWith('02') && clean.length === 9) return clean.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3')
  if (clean.length === 10) return clean.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')
  return value
}

export function formatDurationCompact(sec) {
  if (!sec || sec <= 0) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}
