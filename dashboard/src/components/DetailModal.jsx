import { useEffect } from 'react'
import AudioPlayer from './AudioPlayer'

export default function DetailModal({ call, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!call) return null

  const emotionLabel = getEmotionLabel(call.ai_emotion || call.sentiment)
  const emotionStyle = getEmotionStyle(call.ai_emotion || call.sentiment)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40" onClick={onClose}>
      <div
        className="bg-surface rounded-lg shadow-modal w-full max-w-[680px] max-h-[90vh] overflow-hidden flex flex-col"
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Audio Player */}
          {call.recording_path && (
            <AudioPlayer src={`/recordings/${call.recording_path.split(/[/\\]/).pop()}`} />
          )}

          {call.ai_analyzed === 1 ? (
            <>
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
                  <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
                    {call.ai_summary || call.summary}
                  </p>
                </div>
              )}

              {/* Transcript */}
              {call.transcript && (
                <div>
                  <p className="text-xs text-ink-tertiary mb-1.5">STT 전사 텍스트</p>
                  <div className="text-sm text-ink-secondary leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto bg-surface-panel rounded px-3 py-2.5">
                    {call.transcript}
                  </div>
                </div>
              )}

              {/* Checklist */}
              {call.checklist && Array.isArray(call.checklist) && call.checklist.length > 0 && (
                <div>
                  <p className="text-xs text-ink-tertiary mb-1.5">체크리스트</p>
                  <ul className="space-y-1.5">
                    {call.checklist.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-ink-secondary">
                        <svg className="w-3.5 h-3.5 text-brand mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <span>{typeof item === 'string' ? item : item.text || JSON.stringify(item)}</span>
                      </li>
                    ))}
                  </ul>
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
            </>
          ) : (
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
