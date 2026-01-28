import AudioPlayer from './AudioPlayer'
import StatusBadge from './StatusBadge'

export default function CallDetail({ call }) {
  if (!call) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <div className="text-center">
          <svg className="mx-auto h-12 w-12 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <p className="text-lg">통화를 선택하세요</p>
          <p className="text-sm mt-1">왼쪽 목록에서 통화를 클릭하면 상세 정보가 표시됩니다</p>
        </div>
      </div>
    )
  }

  const sentimentColor = getSentimentColor(call.sentiment)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">
            {call.phone_number || 'UNKNOWN'}
          </h2>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
            <span>{call.direction === 'IN' ? '수신 통화' : '발신 통화'}</span>
            <span>{call.created_at}</span>
            {call.duration > 0 && <span>{Math.floor(call.duration / 60)}분 {call.duration % 60}초</span>}
          </div>
        </div>
        <StatusBadge status={call.status} analyzed={call.ai_analyzed} />
      </div>

      {/* Audio Player */}
      {call.recording_path && (
        <AudioPlayer src={`/recordings/${call.recording_path.split(/[/\\]/).pop()}`} />
      )}

      {/* AI Analysis Results */}
      {call.ai_analyzed === 1 ? (
        <div className="space-y-4">
          {/* Sentiment */}
          {call.sentiment && (
            <div className={`rounded-lg p-4 ${sentimentColor.bg}`}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-700">감정 분석</h3>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${sentimentColor.badge}`}>
                    {call.sentiment}
                  </span>
                  {call.sentiment_score != null && (
                    <span className="text-sm text-gray-500">{call.sentiment_score}점</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Summary */}
          {call.summary && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-700 mb-2">통화 요약</h3>
              <p className="text-gray-600 leading-relaxed whitespace-pre-wrap">{call.summary}</p>
            </div>
          )}

          {/* Transcript */}
          {call.transcript && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-700 mb-2">전체 전사 (STT)</h3>
              <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto">
                {call.transcript}
              </p>
            </div>
          )}

          {/* Checklist */}
          {call.checklist && Array.isArray(call.checklist) && call.checklist.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-700 mb-2">체크리스트</h3>
              <ul className="space-y-2">
                {call.checklist.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-gray-600">
                    <span className="text-blue-500 mt-0.5">&#10003;</span>
                    <span>{typeof item === 'string' ? item : item.text || JSON.stringify(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Analysis Timestamp */}
          {call.analyzed_at && (
            <p className="text-xs text-gray-400 text-right">
              분석 완료: {call.analyzed_at}
            </p>
          )}
        </div>
      ) : (
        <div className="bg-yellow-50 rounded-lg p-6 text-center">
          <p className="text-yellow-700 font-medium">AI 분석 대기 중...</p>
          <p className="text-yellow-600 text-sm mt-1">녹취 파일이 업로드되면 자동으로 분석이 시작됩니다</p>
        </div>
      )}
    </div>
  )
}

function getSentimentColor(sentiment) {
  if (!sentiment) return { bg: 'bg-gray-50', badge: 'bg-gray-200 text-gray-700' }
  const s = sentiment.toLowerCase()
  if (s.includes('positive') || s.includes('긍정')) {
    return { bg: 'bg-green-50', badge: 'bg-green-100 text-green-800' }
  }
  if (s.includes('negative') || s.includes('부정')) {
    return { bg: 'bg-red-50', badge: 'bg-red-100 text-red-800' }
  }
  return { bg: 'bg-blue-50', badge: 'bg-blue-100 text-blue-800' }
}
