import { useEffect } from 'react'
import AudioPlayer from './AudioPlayer'

export default function DetailModal({ call, onClose }) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!call) return null

  const emotionLabel = getEmotionLabel(call.ai_emotion || call.sentiment)
  const emotionColor = getEmotionColor(call.ai_emotion || call.sentiment)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              {call.customer_name || call.phone_number || '통화 상세'}
            </h2>
            <div className="flex items-center gap-3 mt-0.5 text-sm text-slate-500">
              <span>{call.direction === 'OUT' ? '발신' : '수신'}</span>
              {call.uploader_name && <span>담당: {call.uploader_name}</span>}
              <span>{formatDateTime(call.created_at)}</span>
              {call.duration > 0 && <span>{formatDuration(call.duration)}</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Audio Player */}
          {call.recording_path && (
            <AudioPlayer src={`/recordings/${call.recording_path.split(/[/\\]/).pop()}`} />
          )}

          {/* AI Analysis Grid */}
          {call.ai_analyzed === 1 ? (
            <>
              {/* Emotion + Score Row */}
              <div className="grid grid-cols-2 gap-4">
                <div className={`rounded-xl p-4 ${emotionColor.bg} border ${emotionColor.border}`}>
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1">감정 분석</p>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-bold ${emotionColor.badge}`}>
                      {emotionLabel}
                    </span>
                  </div>
                </div>
                <div className="rounded-xl p-4 bg-slate-50 border border-slate-200">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-1">AI 점수</p>
                  <div className="flex items-center gap-3">
                    <span className="text-3xl font-bold text-slate-800">
                      {call.ai_score != null ? call.ai_score : '-'}
                    </span>
                    <span className="text-sm text-slate-400">/ 10</span>
                    {call.ai_score != null && (
                      <div className="flex-1">
                        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${call.ai_score >= 7 ? 'bg-emerald-500' : call.ai_score >= 4 ? 'bg-amber-500' : 'bg-rose-500'}`}
                            style={{ width: `${(call.ai_score / 10) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Summary */}
              {(call.ai_summary || call.summary) && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">AI 요약</p>
                  <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {call.ai_summary || call.summary}
                  </p>
                </div>
              )}

              {/* Transcript */}
              {call.transcript && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">STT 전사 텍스트</p>
                  <div className="text-slate-600 text-sm leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto bg-slate-50 rounded-lg p-3">
                    {call.transcript}
                  </div>
                </div>
              )}

              {/* Checklist */}
              {call.checklist && Array.isArray(call.checklist) && call.checklist.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2">체크리스트</p>
                  <ul className="space-y-2">
                    {call.checklist.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-slate-600 text-sm">
                        <svg className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        <span>{typeof item === 'string' ? item : item.text || JSON.stringify(item)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Meta Info */}
              <div className="flex items-center justify-between text-xs text-slate-400 pt-2">
                <div className="flex gap-4">
                  {call.phone_number && <span>전화번호: {call.phone_number}</span>}
                  {call.customer_name && <span>고객: {call.customer_name}</span>}
                </div>
                {call.analyzed_at && <span>분석: {call.analyzed_at}</span>}
              </div>
            </>
          ) : (
            <div className="bg-amber-50 rounded-xl p-8 text-center border border-amber-200">
              <p className="text-amber-700 font-medium text-lg">
                {call.ai_status === 'processing' ? 'AI 분석 진행 중...' :
                 call.ai_status === 'failed' ? 'AI 분석 실패' :
                 'AI 분석 대기 중'}
              </p>
              <p className="text-amber-600 text-sm mt-1">
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

function getEmotionColor(emotion) {
  if (!emotion) return { bg: 'bg-slate-50', border: 'border-slate-200', badge: 'bg-slate-200 text-slate-700' }
  const e = emotion.toLowerCase()
  if (e.includes('positive')) return { bg: 'bg-emerald-50', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-800' }
  if (e.includes('negative')) return { bg: 'bg-rose-50', border: 'border-rose-200', badge: 'bg-rose-100 text-rose-800' }
  return { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-800' }
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
