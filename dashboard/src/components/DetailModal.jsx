import { useEffect, useMemo } from 'react'
import AudioPlayer from './AudioPlayer'

export default function DetailModal({ call, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Parse transcript lines for chat view (hooks must be before conditional return)
  const chatLines = useMemo(() => {
    if (!call) return []
    const text = call.transcript || call.raw_transcript
    if (!text) return []

    return text.split('\n').map(line => {
      const trimmed = line.trim()
      if (!trimmed) return null

      let type = 'unknown'
      let content = trimmed

      if (trimmed.startsWith('상담원:')) {
        type = 'agent'
        content = trimmed.replace(/^상담원:\s*/, '')
      } else if (trimmed.startsWith('고객:')) {
        type = 'customer'
        content = trimmed.replace(/^고객:\s*/, '')
      }

      if (!content) return null
      return { type, content }
    }).filter(Boolean)
  }, [call])

  if (!call) return null

  const emotionLabel = getEmotionLabel(call.ai_emotion || call.sentiment)
  const emotionStyle = getEmotionStyle(call.ai_emotion || call.sentiment)
  const isAnalyzed = call.ai_analyzed === 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40" onClick={onClose}>
      <div
        className="bg-surface rounded-lg shadow-modal w-full max-w-[1200px] max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {call.customer_name || call.phone_number || '통화 상세'}
            </h2>
            <div className="flex items-center gap-2.5 mt-0.5 text-sm text-ink-tertiary">
              <span>{call.direction === 'OUT' ? '발신' : '수신'}</span>
              {call.uploader_name && (
                <>
                  <span className="text-line">|</span>
                  <span>담당 {call.uploader_name}</span>
                </>
              )}
              <span className="text-line">|</span>
              <span>{formatDateTime(call.created_at)}</span>
              {call.duration > 0 && (
                <>
                  <span className="text-line">|</span>
                  <span>{formatDuration(call.duration)}</span>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-surface-panel text-ink-tertiary hover:text-ink transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body: Left-Right Split */}
        <div className={`flex-1 overflow-hidden flex ${!isAnalyzed ? 'flex-col' : ''}`}>
          {isAnalyzed ? (
            <>
              {/* ===== Left Panel: Meta + Audio + AI Summary ===== */}
              <div className="w-[380px] shrink-0 border-r border-line overflow-y-auto px-6 py-5 space-y-4">
                {/* Audio Player */}
                {call.recording_path && (
                  <AudioPlayer src={`/recordings/${call.recording_path.split(/[/\\]/).pop()}`} />
                )}

                {/* Emotion + Score */}
                <div className="flex items-center gap-6 py-3 border-b border-line-light">
                  <div>
                    <p className="text-xs text-ink-tertiary mb-1">감정</p>
                    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${emotionStyle.text}`}>
                      <span className={`w-2 h-2 rounded-full ${emotionStyle.dot}`} />
                      {emotionLabel}
                    </span>
                  </div>
                  <div className="w-px h-8 bg-line-light" />
                  <div>
                    <p className="text-xs text-ink-tertiary mb-1">AI 점수</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-semibold text-ink">
                        {call.ai_score != null ? call.ai_score : '-'}
                      </span>
                      <span className="text-xs text-ink-tertiary">/ 10</span>
                      {call.ai_score != null && (
                        <div className="w-20 h-1.5 bg-surface-panel rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${call.ai_score >= 7 ? 'bg-positive' : call.ai_score >= 4 ? 'bg-caution' : 'bg-negative'}`}
                            style={{ width: `${(call.ai_score / 10) * 100}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Summary */}
                {(call.ai_summary || call.summary) && (
                  <div>
                    <p className="text-xs text-ink-tertiary mb-1.5">AI 요약</p>
                    <div className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
                      {call.ai_summary || call.summary}
                    </div>
                  </div>
                )}

                {/* Footer meta */}
                <div className="flex items-center justify-between text-xs text-ink-tertiary pt-2 border-t border-line-light">
                  <div className="flex gap-3">
                    {call.phone_number && <span>{call.phone_number}</span>}
                    {call.customer_name && <span>고객: {call.customer_name}</span>}
                  </div>
                  {call.analyzed_at && <span>분석 {call.analyzed_at}</span>}
                </div>
              </div>

              {/* ===== Right Panel: Chat-Style Transcript ===== */}
              <div className="flex-1 overflow-y-auto px-6 py-5 bg-surface-page">
                <p className="text-xs text-ink-tertiary mb-3">고객 상담 내용</p>
                {chatLines.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    {chatLines.map((line, i) => (
                      <div
                        key={i}
                        className={`flex flex-col ${line.type === 'customer' ? 'items-end' : 'items-start'}`}
                      >
                        <span className="text-[10px] text-ink-tertiary mb-0.5">
                          {line.type === 'agent' ? '상담원' : line.type === 'customer' ? '고객' : ''}
                        </span>
                        <div
                          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                            line.type === 'agent'
                              ? 'bg-surface text-ink border border-line-light'
                              : line.type === 'customer'
                                ? 'bg-brand-light text-ink'
                                : 'bg-surface-panel text-ink-secondary'
                          }`}
                        >
                          {line.content}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-ink-tertiary text-center py-8">
                    통화 내용이 없습니다
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center px-6 py-8">
              <div className="bg-surface-panel rounded px-6 py-8 text-center">
                <p className="text-base font-medium text-ink-secondary">
                  {call.ai_status === 'processing' ? 'AI 분석 진행 중...' :
                   call.ai_status === 'failed' ? 'AI 분석 실패' :
                   'AI 분석 대기 중'}
                </p>
                <p className="text-sm text-ink-tertiary mt-1">
                  {call.ai_status === 'processing' ? '잠시 후 결과가 표시됩니다' :
                   call.ai_status === 'failed' ? '관리자에게 문의하세요' :
                   '녹취 파일이 업로드되면 자동으로 분석됩니다'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function getEmotionLabel(emotion) {
  if (!emotion) return '-'
  const e = emotion.toLowerCase()
  if (e.includes('positive')) return '긍정'
  if (e.includes('negative')) return '부정'
  return '중립'
}

function getEmotionStyle(emotion) {
  if (!emotion) return { text: 'text-ink-tertiary', dot: 'bg-ink-tertiary' }
  const e = emotion.toLowerCase()
  if (e.includes('positive')) return { text: 'text-positive', dot: 'bg-positive' }
  if (e.includes('negative')) return { text: 'text-negative', dot: 'bg-negative' }
  return { text: 'text-ink-tertiary', dot: 'bg-ink-tertiary' }
}

function formatDateTime(dateStr) {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    })
  } catch { return dateStr }
}

function formatDuration(sec) {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}분 ${s}초`
}
