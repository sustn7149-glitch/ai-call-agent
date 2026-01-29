export function DirectionBadge({ direction }) {
  if (direction === 'OUT') {
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs text-ink-secondary bg-surface-panel">발신</span>
  }
  return <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs text-brand bg-brand-light">수신</span>
}

export function EmotionBadge({ emotion }) {
  if (!emotion) return <span className="text-ink-tertiary text-sm">-</span>
  const e = emotion.toLowerCase()
  if (e.includes('positive')) {
    return <span className="inline-flex items-center gap-1 text-xs text-positive"><span className="w-1.5 h-1.5 rounded-full bg-positive" />긍정</span>
  }
  if (e.includes('negative')) {
    return <span className="inline-flex items-center gap-1 text-xs text-negative"><span className="w-1.5 h-1.5 rounded-full bg-negative" />부정</span>
  }
  return <span className="inline-flex items-center gap-1 text-xs text-ink-tertiary"><span className="w-1.5 h-1.5 rounded-full bg-ink-tertiary" />중립</span>
}

export function ScoreBadge({ score }) {
  if (score == null) return <span className="text-ink-tertiary text-sm">-</span>

  let color = 'text-ink-secondary'
  if (score >= 7) color = 'text-positive'
  else if (score <= 3) color = 'text-negative'

  return <span className={`text-sm font-semibold ${color}`}>{score}</span>
}

export function AiStatusBadge({ status, analyzed }) {
  if (analyzed === 1 || status === 'completed') {
    return <span className="inline-flex items-center gap-1 text-xs text-positive"><span className="w-1.5 h-1.5 rounded-full bg-positive" />완료</span>
  }
  if (status === 'processing') {
    return <span className="inline-flex items-center gap-1 text-xs text-brand"><span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />분석중</span>
  }
  if (status === 'failed') {
    return <span className="inline-flex items-center gap-1 text-xs text-negative"><span className="w-1.5 h-1.5 rounded-full bg-negative" />실패</span>
  }
  return <span className="inline-flex items-center gap-1 text-xs text-ink-tertiary"><span className="w-1.5 h-1.5 rounded-full bg-line" />대기</span>
}
