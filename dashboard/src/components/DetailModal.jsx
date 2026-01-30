import { useEffect, useMemo } from 'react'
import AudioPlayer from './AudioPlayer'
import { formatPhoneNumber, formatDateTime, formatDurationCompact } from '../utils'

export default function DetailModal({ call, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Parse transcript lines for chat view (hooks must be before conditional return)
  const chatLines = useMemo(() => {
    if (!call) return []
    if (!call.transcript && !call.raw_transcript) return []
    const text = call.transcript || call.raw_transcript

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
        className={`bg-surface rounded-lg shadow-modal w-full flex flex-col overflow-hidden max-h-[90vh]
          ${isAnalyzed ? 'max-w-[1200px] w-[90vw]' : 'max-w-[680px]'}`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-line flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {call.customer_name || formatPhoneNumber(call.phone_number) || '통화 상세'}
            </h2>
            <div className="flex items-center gap-2.5 mt-0.5 text-sm text-ink-tertiary">
              <span>{call.direction === 'OUT' ? '발신' : '수신'}</span>
              <span className="text-line">|</span>
              <span>{formatDateTime(call.created_at)}</span>
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

        {/* Content Body */}
        <div className={`flex items-stretch overflow-hidden flex-1 ${!isAnalyzed ? 'flex-col' : ''}`}>

          {/* Left Panel (Meta + Summary) */}
          <div className={`${isAnalyzed ? 'w-[380px] border-r border-line' : 'w-full'} flex flex-col bg-surface overflow-y-auto`}>
            <div className="p-6 space-y-6">
              {/* Meta Grid */}
              <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
                <div>
                  <label className="block text-xs text-ink-tertiary mb-1">고객명</label>
                  <div className="font-medium text-ink">{call.customer_name || '-'}</div>
                </div>
                <div>
                  <label className="block text-xs text-ink-tertiary mb-1">전화번호</label>
                  <div className="font-medium text-ink font-mono">{formatPhoneNumber(call.phone_number)}</div>
                </div>
                <div>
                  <label className="block text-xs text-ink-tertiary mb-1">담당자</label>
                  <div className="font-medium text-ink">{call.uploader_name || '-'}</div>
                </div>
                <div>
                  <label className="block text-xs text-ink-tertiary mb-1">팀</label>
                  <div className="font-medium text-ink">{call.team_name || '-'}</div>
                </div>
                <div>
                  <label className="block text-xs text-ink-tertiary mb-1">통화 시간</label>
                  <div className="font-medium text-ink font-mono">{formatDurationCompact(call.duration)}</div>
                </div>
              </div>

              {/* Audio Player */}
              {call.recording_path && (
                <div className="pt-2">
                  <AudioPlayer src={`/recordings/${call.recording_path.split(/[/\\]/).pop()}`} />
                </div>
              )}

              {isAnalyzed ? (
                <>
                  <div className="h-px bg-line-light" />

                  {/* Emotion + Score */}
                  <div className="flex items-center gap-6">
                    <div>
                      <p className="text-xs text-ink-tertiary mb-1">감정</p>
                      <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${emotionStyle.text}`}>
                        <span className={`w-2 h-2 rounded-full ${emotionStyle.dot}`} />
                        {emotionLabel}
                      </span>
                    </div>
                    <div className="w-px h-8 bg-line-light" />
                    <div className="flex-1">
                      <p className="text-xs text-ink-tertiary mb-1">AI 점수 ({call.ai_score || 0}/10)</p>
                      <div className="w-full h-2 bg-surface-panel rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${call.ai_score >= 7 ? 'bg-positive' : call.ai_score >= 4 ? 'bg-caution' : 'bg-negative'}`}
                          style={{ width: `${((call.ai_score || 0) / 10) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  {(call.ai_summary || call.summary) && (
                    <div className="bg-surface-panel rounded-lg p-3">
                      <p className="text-xs font-semibold text-ink-secondary mb-2">AI 요약</p>
                      <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
                        {call.ai_summary || call.summary}
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-surface-panel rounded-lg px-4 py-6 text-center mt-4">
                  <p className="text-base font-medium text-ink-secondary">
                    {call.ai_status === 'processing' ? 'AI 분석 진행 중...' :
                      call.ai_status === 'failed' ? 'AI 분석 실패' :
                        'AI 분석 대기 중'}
                  </p>
                  <p className="text-xs text-ink-tertiary mt-1">
                    {call.ai_status === 'processing' ? '잠시 후 결과가 표시됩니다' :
                      call.ai_status === 'failed' ? '관리자에게 문의하세요' :
                        '녹취 파일이 업로드되면 자동으로 분석됩니다'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel (Chat Transcript) */}
          {isAnalyzed && (
            <div className="flex-1 bg-surface-page flex flex-col min-h-0">
              <div className="flex-none px-6 py-3 border-b border-line bg-surface flex justify-between items-center">
                <h3 className="text-sm font-semibold text-ink">상담 내용</h3>
                <span className="text-xs text-ink-tertiary">
                  {chatLines.length}개의 대화
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
                {chatLines.length > 0 ? (
                  chatLines.map((line, idx) => (
                    <div
                      key={idx}
                      className={`flex flex-col max-w-[85%] ${line.type === 'customer' ? 'self-end items-end' : 'self-start items-start'
                        }`}
                    >
                      <span className="text-[10px] text-ink-tertiary mb-1 px-1">
                        {line.type === 'customer' ? '고객' : line.type === 'agent' ? '상담원' : '알 수 없음'}
                      </span>
                      <div
                        className={`px-4 py-2.5 rounded-lg text-sm leading-relaxed whitespace-pre-wrap shadow-sm
                           ${line.type === 'customer'
                            ? 'bg-brand-light text-ink rounded-tr-none'
                            : 'bg-white border border-line-light text-ink rounded-tl-none'}`}
                      >
                        {line.content}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-ink-tertiary">
                    <svg className="w-10 h-10 mb-3 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    <p className="text-sm">대화 내용이 없습니다</p>
                  </div>
                )}
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
