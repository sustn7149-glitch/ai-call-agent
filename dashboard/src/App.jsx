import { useState, useEffect, useCallback } from 'react'
import { io } from 'socket.io-client'
import CallList from './components/CallList'
import CallDetail from './components/CallDetail'

const socket = io('/', { transports: ['websocket', 'polling'] })

export default function App() {
  const [calls, setCalls] = useState([])
  const [selectedCall, setSelectedCall] = useState(null)
  const [connected, setConnected] = useState(false)

  // 초기 통화 목록 로드
  const fetchCalls = useCallback(async () => {
    try {
      const res = await fetch('/api/calls')
      const data = await res.json()
      setCalls(data)
    } catch (err) {
      console.error('Failed to fetch calls:', err)
    }
  }, [])

  useEffect(() => {
    fetchCalls()

    // Socket.io 연결
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    // 실시간 이벤트 수신
    socket.on('call-status', () => fetchCalls())
    socket.on('queue:job-completed', () => fetchCalls())
    socket.on('queue:job-added', () => fetchCalls())

    return () => {
      socket.off('connect')
      socket.off('disconnect')
      socket.off('call-status')
      socket.off('queue:job-completed')
      socket.off('queue:job-added')
    }
  }, [fetchCalls])

  // 통화 선택 시 상세 정보 로드
  const handleSelectCall = async (call) => {
    try {
      const res = await fetch(`/api/calls/${call.id}`)
      const data = await res.json()
      setSelectedCall(data)
    } catch (err) {
      console.error('Failed to fetch call detail:', err)
      setSelectedCall(call)
    }
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-800">AI Call Agent</h1>
          <span className="text-sm text-gray-400">Dashboard</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm text-gray-500">
            {connected ? '실시간 연결됨' : '연결 끊김'}
          </span>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Call List */}
        <div className="w-96 border-r border-gray-200 bg-white overflow-y-auto">
          <CallList
            calls={calls}
            selectedId={selectedCall?.id}
            onSelect={handleSelectCall}
          />
        </div>

        {/* Right Panel - Call Detail */}
        <div className="flex-1 overflow-y-auto">
          <CallDetail call={selectedCall} />
        </div>
      </div>
    </div>
  )
}
