import { Outlet } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import useSocket from './hooks/useSocket'

export default function App() {
  const { connected } = useSocket()

  return (
    <div className="min-h-screen bg-surface-page">
      <Sidebar connected={connected} />
      <main className="ml-[220px] min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
