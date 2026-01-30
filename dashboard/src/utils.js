export function formatDateTime(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    })
  } catch { return dateStr }
}

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

// Compact duration: 3661 -> "1:01:01", 125 -> "2:05"
export function formatDurationCompact(sec) {
  if (!sec || sec <= 0) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Elapsed time from ISO string to now in mm:ss
export function elapsedTimer(isoStr, now) {
  if (!isoStr) return null
  const start = new Date(isoStr).getTime()
  if (isNaN(start)) return null
  const diff = Math.max(0, Math.floor(((now || Date.now()) - start) / 1000))
  const m = Math.floor(diff / 60)
  const s = diff % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export function formatPhoneNumber(value) {
  if (!value) return value;
  // If already contains hyphen, return as is (idempotent)
  if (value.includes('-')) return value;

  const clean = value.replace(/[^0-9]/g, '');

  // 11-digit mobile: 010-1234-5678
  if (clean.length === 11) {
    return clean.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }

  // 10-digit Seoul: 02-1234-5678
  if (clean.startsWith('02') && clean.length === 10) {
    return clean.replace(/(\d{2})(\d{4})(\d{4})/, '$1-$2-$3');
  }

  // 9-digit Seoul: 02-123-4567
  if (clean.startsWith('02') && clean.length === 9) {
    return clean.replace(/(\d{2})(\d{3})(\d{4})/, '$1-$2-$3');
  }

  // 10-digit Area/Mobile: 0XX-XXX-XXXX
  if (clean.length === 10) {
    return clean.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  }

  return value;
}
