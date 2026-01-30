import { useState, useEffect, useCallback } from 'react'

const TABS = [
  { key: 'teams', label: '팀 관리' },
  { key: 'agents', label: '직원 관리' },
]

export default function Settings() {
  const [tab, setTab] = useState('teams')

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Tab Header */}
      <div className="flex gap-1 border-b border-line">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-brand text-brand'
                : 'border-transparent text-ink-tertiary hover:text-ink-secondary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'teams' && <TeamManagement />}
      {tab === 'agents' && <AgentManagement />}
    </div>
  )
}

/* ═══════════════════════════════════════════
   팀 관리 (Team Management)
   ═══════════════════════════════════════════ */
function TeamManagement() {
  const [teams, setTeams] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [editData, setEditData] = useState({ name: '', description: '', evaluation_prompt: '' })
  const [newTeam, setNewTeam] = useState({ name: '', description: '', evaluation_prompt: '' })
  const [showAddForm, setShowAddForm] = useState(false)
  const [error, setError] = useState('')

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch('/api/teams')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setTeams(await res.json())
    } catch (err) {
      console.error('Failed to fetch teams:', err)
    }
  }, [])

  useEffect(() => { fetchTeams() }, [fetchTeams])

  const handleAdd = async () => {
    if (!newTeam.name.trim()) return
    setError('')
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTeam),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '팀 생성 실패')
        return
      }
      setNewTeam({ name: '', description: '', evaluation_prompt: '' })
      setShowAddForm(false)
      fetchTeams()
    } catch (err) {
      setError('팀 생성 실패')
    }
  }

  const startEdit = (team) => {
    setEditingId(team.id)
    setEditData({
      name: team.name || '',
      description: team.description || '',
      evaluation_prompt: team.evaluation_prompt || '',
    })
  }

  const saveEdit = async (id) => {
    setError('')
    try {
      const res = await fetch(`/api/teams/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '수정 실패')
        return
      }
      setEditingId(null)
      fetchTeams()
    } catch (err) {
      setError('수정 실패')
    }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`"${name}" 팀을 삭제하시겠습니까?`)) return
    setError('')
    try {
      const res = await fetch(`/api/teams/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '삭제 실패')
        return
      }
      fetchTeams()
    } catch (err) {
      setError('삭제 실패')
    }
  }

  return (
    <div className="space-y-3">
      {/* Header + Add button */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink">팀 목록</h2>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-1.5 text-xs rounded border border-brand text-brand hover:bg-brand-light transition-colors"
        >
          {showAddForm ? '취소' : '+ 새 팀 추가'}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-negative bg-red-50 border border-red-200 rounded">
          {error}
        </div>
      )}

      {/* Add Form */}
      {showAddForm && (
        <div className="bg-surface border border-line rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-tertiary mb-1">팀 이름 *</label>
              <input
                type="text"
                placeholder="예: 영업팀"
                value={newTeam.name}
                onChange={e => setNewTeam(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-line rounded px-2.5 py-1.5 text-sm text-ink bg-surface focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-tertiary mb-1">설명</label>
              <input
                type="text"
                placeholder="팀 설명 (선택)"
                value={newTeam.description}
                onChange={e => setNewTeam(p => ({ ...p, description: e.target.value }))}
                className="w-full border border-line rounded px-2.5 py-1.5 text-sm text-ink bg-surface focus:border-brand focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-ink-tertiary mb-1">AI 평가 기준 (System Prompt)</label>
            <textarea
              rows={4}
              placeholder="이 팀의 통화를 AI가 평가할 때 사용할 기준을 입력하세요.&#10;예: 고객에게 상품 가입을 적극 권유하고 성공했는지 평가하라."
              value={newTeam.evaluation_prompt}
              onChange={e => setNewTeam(p => ({ ...p, evaluation_prompt: e.target.value }))}
              className="w-full border border-line rounded px-2.5 py-1.5 text-sm text-ink bg-surface focus:border-brand focus:outline-none resize-y"
            />
            <p className="text-[10px] text-ink-tertiary mt-1">비워두면 기본 평가 기준이 적용됩니다.</p>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleAdd}
              className="px-4 py-1.5 bg-brand text-white text-sm rounded hover:opacity-90 transition-opacity"
            >
              팀 생성
            </button>
          </div>
        </div>
      )}

      {/* Team List */}
      <div className="space-y-2">
        {teams.length === 0 ? (
          <div className="bg-surface border border-line rounded-lg py-8 text-center">
            <p className="text-sm text-ink-tertiary">등록된 팀이 없습니다</p>
            <p className="text-xs text-ink-tertiary mt-1">'+ 새 팀 추가' 버튼을 눌러 팀을 만들어주세요</p>
          </div>
        ) : (
          teams.map(team => {
            const isEditing = editingId === team.id
            return (
              <div key={team.id} className="bg-surface border border-line rounded-lg overflow-hidden">
                {isEditing ? (
                  /* Edit mode */
                  <div className="p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-ink-tertiary mb-1">팀 이름</label>
                        <input
                          type="text"
                          value={editData.name}
                          onChange={e => setEditData(p => ({ ...p, name: e.target.value }))}
                          className="w-full border border-line rounded px-2.5 py-1.5 text-sm text-ink bg-surface-page focus:border-brand focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-ink-tertiary mb-1">설명</label>
                        <input
                          type="text"
                          value={editData.description}
                          onChange={e => setEditData(p => ({ ...p, description: e.target.value }))}
                          className="w-full border border-line rounded px-2.5 py-1.5 text-sm text-ink bg-surface-page focus:border-brand focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-ink-tertiary mb-1">AI 평가 기준 (System Prompt)</label>
                      <textarea
                        rows={4}
                        value={editData.evaluation_prompt}
                        onChange={e => setEditData(p => ({ ...p, evaluation_prompt: e.target.value }))}
                        className="w-full border border-line rounded px-2.5 py-1.5 text-sm text-ink bg-surface-page focus:border-brand focus:outline-none resize-y"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1.5 text-xs text-ink-tertiary border border-line rounded hover:bg-surface-panel transition-colors"
                      >
                        취소
                      </button>
                      <button
                        onClick={() => saveEdit(team.id)}
                        className="px-3 py-1.5 text-xs text-white bg-brand rounded hover:opacity-90 transition-opacity"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-ink">{team.name}</span>
                          {team.description && (
                            <span className="text-xs text-ink-tertiary">- {team.description}</span>
                          )}
                        </div>
                        {team.evaluation_prompt ? (
                          <p className="text-xs text-ink-secondary mt-1.5 line-clamp-2 whitespace-pre-wrap">
                            {team.evaluation_prompt}
                          </p>
                        ) : (
                          <p className="text-xs text-ink-tertiary mt-1.5">기본 평가 기준 사용</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        <button
                          onClick={() => startEdit(team)}
                          className="text-xs text-brand font-medium hover:underline"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleDelete(team.id, team.name)}
                          className="text-xs text-negative font-medium hover:underline"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   직원 관리 (Agent Management)
   ═══════════════════════════════════════════ */
function AgentManagement() {
  const [agents, setAgents] = useState([])
  const [teams, setTeams] = useState([])
  const [editingPhone, setEditingPhone] = useState(null)
  const [editData, setEditData] = useState({ name: '', team_name: '' })
  const [newAgent, setNewAgent] = useState({ phone_number: '', name: '', team_name: '' })

  const fetchData = useCallback(async () => {
    try {
      const [agentsRes, teamsRes] = await Promise.all([
        fetch('/api/agents'),
        fetch('/api/teams'),
      ])
      setAgents(await agentsRes.json())
      setTeams(await teamsRes.json())
    } catch (err) {
      console.error('Failed to fetch data:', err)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleAdd = async () => {
    if (!newAgent.phone_number.trim()) return
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAgent),
      })
      if (!res.ok) {
        console.error('Failed to add agent:', res.status)
        return
      }
      setNewAgent({ phone_number: '', name: '', team_name: '' })
      fetchData()
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
      const res = await fetch(`/api/agents/${encodeURIComponent(phone)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData),
      })
      if (!res.ok) {
        console.error('Failed to update agent:', res.status)
        return
      }
      setEditingPhone(null)
      fetchData()
    } catch (err) {
      console.error('Failed to update agent:', err)
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-surface border border-line rounded-lg overflow-hidden">
        {/* Add Form */}
        <div className="px-4 py-3 border-b border-line-light bg-surface-panel flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-ink-tertiary mb-1">전화번호</label>
            <input
              type="text"
              placeholder="01012345678"
              value={newAgent.phone_number}
              onChange={e => setNewAgent(p => ({ ...p, phone_number: e.target.value }))}
              className="border border-line rounded px-2.5 py-1.5 text-sm text-ink bg-surface w-40 focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-tertiary mb-1">이름</label>
            <input
              type="text"
              placeholder="홍길동"
              value={newAgent.name}
              onChange={e => setNewAgent(p => ({ ...p, name: e.target.value }))}
              className="border border-line rounded px-2.5 py-1.5 text-sm text-ink bg-surface w-32 focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-ink-tertiary mb-1">팀</label>
            <select
              value={newAgent.team_name}
              onChange={e => setNewAgent(p => ({ ...p, team_name: e.target.value }))}
              className="border border-line rounded px-2.5 py-1.5 text-sm text-ink bg-surface w-32"
            >
              <option value="">선택</option>
              {teams.map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
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
              <tr className="border-b border-line bg-surface-panel">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">전화번호</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">이름</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">소속 팀</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-ink-tertiary">등록일</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {agents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-tertiary">
                    등록된 직원이 없습니다
                  </td>
                </tr>
              ) : (
                agents.map((agent) => {
                  const isEditing = editingPhone === agent.phone_number
                  return (
                    <tr key={agent.phone_number} className="border-b border-line-light last:border-b-0 hover:bg-surface-panel transition-colors">
                      <td className="px-4 py-2.5 text-sm text-ink font-mono">{agent.phone_number}</td>
                      <td className="px-4 py-2.5 text-sm text-ink">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editData.name}
                            onChange={e => setEditData(p => ({ ...p, name: e.target.value }))}
                            className="border border-line rounded px-2 py-1 text-sm text-ink bg-surface-page w-28 focus:border-brand focus:outline-none"
                          />
                        ) : (
                          agent.name || '-'
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-ink">
                        {isEditing ? (
                          <select
                            value={editData.team_name}
                            onChange={e => setEditData(p => ({ ...p, team_name: e.target.value }))}
                            className="border border-line rounded px-2 py-1 text-sm text-ink bg-surface-page w-28"
                          >
                            <option value="">선택</option>
                            {teams.map(t => (
                              <option key={t.id} value={t.name}>{t.name}</option>
                            ))}
                          </select>
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
