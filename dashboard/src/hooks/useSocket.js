import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'

let socketInstance = null

function getSocket() {
  if (!socketInstance) {
    socketInstance = io('/', { transports: ['websocket', 'polling'] })
  }
  return socketInstance
}

export default function useSocket() {
  const socketRef = useRef(getSocket())
  const [connected, setConnected] = useState(socketRef.current.connected)

  useEffect(() => {
    const s = socketRef.current
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)

    s.on('connect', onConnect)
    s.on('disconnect', onDisconnect)

    return () => {
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
    }
  }, [])

  return { socket: socketRef.current, connected }
}
