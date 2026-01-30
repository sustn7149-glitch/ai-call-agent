import { useState, useEffect, useCallback } from 'react'

export default function Settings() {
  const [agents, setAgents] = useState([])
  const [editingPhone, setEditingPhone] = useState(null)
  const [editData, setEditData] = useState({ name: '', team_name: '' })

  // New agent form
  const [newAgent, setNewAgent] = useState({ phone_number: '', name: '', team_name: '' })

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents')
      setAgents(await res.json())
    } catch (err) {
      console.error('Failed to fetch agents:', err)
    }
  }, [])

  useEffect(() => { fetchAgents() }, [fetchAgents])

  const handleAdd = async () => {
    if (!newAgent.phone_number.trim()) return
    try {
      await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAgent),
      })
      setNewAgent({ phone_number: '', name: '', team_name: '' })
      fetchAgents()
    } catch (err) {
      console.error('Failed to add agent:', err)
    }
  }

  const startEdit = (agent) => {
    setEditingPhone(agent.phone_number)
    setEditData({ name: agent.name || '', team_name: agent.team_name || '' })
  }

  const cancelEdit = () => {
    setEditingPhone(null)
    setEditData({ name: '', team_name: '' })
  }

  const saveEdit = async (phone) => {
    try {
      await fetch(`/api/agents/${encodeURIComponent(phone)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData),
      })
      setEditingPhone(null)
      fetchAgents()
    } catch (err) {
      console.error('Failed to update agent:', err)
    }
  }

  return (
    <div className="px-6 py-5 space-y-5">
      <h1 className="text-lg font-semibold text-ink">설정</h1>

      <div className="bg-surface border border-line rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-line-light">
          <h2 className="text-sm font-medium text-ink-secondary">에이전트 관리</h2>
        </div>

        {/* Add Form */}
        <div className="px-5 py-3 border-b border-line-light bg-surface-panel flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-ink-tertiary mb-1">전화번호</label>
            <input
              type="text"
              placeholder="01012345678"
              value={newAgent.phone_number}
              onChange={e => setNewAgent(p => ({ ...p, phone_number: e.target.value }))}
              className="border border-line rounded px-2.5 py-1.5 text-sm text-ink bg-surface w-40"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-tertiary mb-1">이름</label>
            <input
              type="text"
              placeholder="홍길동"
              value={newAgent.name}
              onChange={e => setNewAgent(p => ({ ...p, name: e.target.value }))}
              className="border border-line rounded px-2.5 py-1.5 text-sm text-ink bg-surface w-32"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-tertiary mb-1">팀</label>
            <input
              type="text"
              placeholder="영업1팀"
              value={newAgent.team_name}
              onChange={e => setNewAgent(p => ({ ...p, team_name: e.target.value }))}
              className="border border-line rounded px-2.5 py-1.5 text-sm text-ink bg-surface w-32"
            />
          </div>
          <button
            onClick={handleAdd}
            className="px-4 py-1.5 bg-brand text-white text-sm rounded hover:opacity-90 transition-opacity"
          >
            추가
          </button>
        </div>

        {/* Agent Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">전화번호</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">이름</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">팀</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">등록일</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-tertiary">
                    등록된 에이전트가 없습니다
                  </td>
                </tr>
              ) : (
                agents.map((agent) => {
                  const isEditing = editingPhone === agent.phone_number
                  return (
                    <tr key={agent.phone_number} className="border-b border-line-light last:border-b-0">
                      <td className="px-4 py-2.5 text-sm text-ink font-mono">{agent.phone_number}</td>
                      <td className="px-4 py-2.5 text-sm text-ink">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editData.name}
                            onChange={e => setEditData(p => ({ ...p, name: e.target.value }))}
                            className="border border-line rounded px-2 py-1 text-sm text-ink bg-surface-page w-28"
                          />
                        ) : (
                          agent.name || '-'
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-ink">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editData.team_name}
                            onChange={e => setEditData(p => ({ ...p, team_name: e.target.value }))}
                            className="border border-line rounded px-2 py-1 text-sm text-ink bg-surface-page w-28"
                          />
                        ) : (
                          agent.team_name || '-'
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-ink-tertiary whitespace-nowrap">
                        {agent.created_at ? new Date(agent.created_at).toLocaleDateString('ko-KR') : '-'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {isEditing ? (
                          <div className="flex gap-2 justify-end">
                            <button
                              onClick={() => saveEdit(agent.phone_number)}
                              className="text-xs text-positive font-medium hover:underline"
                            >
                              저장
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-xs text-ink-tertiary hover:underline"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(agent)}
                            className="text-xs text-brand font-medium hover:underline"
                          >
                            수정
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
