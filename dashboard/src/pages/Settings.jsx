import { useState, useEffect, useCallback } from 'react'

const TH = 'border border-gray-300 text-[12px] font-bold text-center text-gray-700 px-2 whitespace-nowrap'
const TD = 'border border-gray-300 text-[12px] text-center text-gray-700 px-2'
const TH_STYLE = { background: '#ECEBFF', height: '26px' }

const TABS = [
  { id: 'teams', label: '팀 관리' },
  { id: 'agents', label: '직원 관리' },
]

/* ═══════════════════════════════ */
/*         팀 관리 탭              */
/* ═══════════════════════════════ */
function TeamManagement() {
  const [teams, setTeams] = useState([])
  const [newTeam, setNewTeam] = useState({ name: '', evaluation_prompt: '' })
  const [editingId, setEditingId] = useState(null)
  const [editData, setEditData] = useState({ name: '', evaluation_prompt: '' })
  const [error, setError] = useState('')

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch('/api/teams')
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
        setError(data.error || '팀 생성에 실패했습니다.')
        return
      }
      setNewTeam({ name: '', evaluation_prompt: '' })
      fetchTeams()
    } catch (err) {
      console.error('Failed to add team:', err)
      setError('팀 생성에 실패했습니다.')
    }
  }

  const startEdit = (team) => {
    setEditingId(team.id)
    setEditData({ name: team.name || '', evaluation_prompt: team.evaluation_prompt || '' })
    setError('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditData({ name: '', evaluation_prompt: '' })
    setError('')
  }

  const saveEdit = async (id) => {
    if (!editData.name.trim()) return
    setError('')
    try {
      const res = await fetch(`/api/teams/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editData),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '수정에 실패했습니다.')
        return
      }
      setEditingId(null)
      fetchTeams()
    } catch (err) {
      console.error('Failed to update team:', err)
      setError('수정에 실패했습니다.')
    }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`"${name}" 팀을 삭제하시겠습니까?\n소속 직원의 팀 배정이 해제됩니다.`)) return
    try {
      await fetch(`/api/teams/${id}`, { method: 'DELETE' })
      fetchTeams()
    } catch (err) {
      console.error('Failed to delete team:', err)
    }
  }

  return (
    <div className="space-y-2">
      {/* 새 팀 등록 폼 */}
      <div className="border border-gray-300">
        <div className="px-3 py-1.5" style={{ background: '#ECEBFF' }}>
          <span className="text-[12px] font-bold text-gray-700">새 팀 등록</span>
        </div>
        <div className="px-3 py-2 bg-white space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[11px] text-gray-500 mb-0.5">팀 이름</label>
              <input type="text" placeholder="예: 영업1팀"
                value={newTeam.name}
                onChange={e => setNewTeam(p => ({ ...p, name: e.target.value }))}
                className="border border-gray-300 px-2 py-1 text-[12px] text-gray-700 bg-white w-44" />
            </div>
            <button onClick={handleAdd}
              className="bg-blue-600 text-white px-3 py-1 text-[11px] hover:bg-blue-700">
              팀 추가
            </button>
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">AI 평가 기준 (프롬프트)</label>
            <textarea placeholder="이 팀의 통화를 평가할 때 사용할 AI 프롬프트를 입력하세요."
              value={newTeam.evaluation_prompt}
              onChange={e => setNewTeam(p => ({ ...p, evaluation_prompt: e.target.value }))}
              rows={2}
              className="border border-gray-300 px-2 py-1 text-[12px] text-gray-700 bg-white w-full resize-y" />
          </div>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
      </div>

      {/* 팀 목록 테이블 */}
      <div className="border border-gray-300">
        <div className="px-3 py-1.5 flex items-center justify-between" style={{ background: '#ECEBFF' }}>
          <span className="text-[12px] font-bold text-gray-700">등록된 팀</span>
          <span className="text-[11px] text-gray-500">{teams.length}개</span>
        </div>
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className={TH} style={TH_STYLE}>ID</th>
              <th className={TH} style={TH_STYLE}>팀 이름</th>
              <th className={TH} style={{ ...TH_STYLE, minWidth: '200px' }}>AI 평가 기준</th>
              <th className={TH} style={TH_STYLE}>등록일</th>
              <th className={TH} style={TH_STYLE}>관리</th>
            </tr>
          </thead>
          <tbody>
            {teams.length === 0 ? (
              <tr>
                <td colSpan={5} className="border border-gray-300 text-center text-[12px] text-gray-400 py-6">
                  등록된 팀이 없습니다
                </td>
              </tr>
            ) : (
              teams.map(team => {
                const isEditing = editingId === team.id
                return (
                  <tr key={team.id} style={{ height: '28px' }}>
                    <td className={`${TD} text-gray-500`}>{team.id}</td>
                    <td className={`${TD} font-medium`}>
                      {isEditing ? (
                        <input type="text" value={editData.name}
                          onChange={e => setEditData(p => ({ ...p, name: e.target.value }))}
                          className="border border-gray-300 px-1.5 py-0.5 text-[12px] text-gray-700 w-32" />
                      ) : team.name}
                    </td>
                    <td className={`${TD} text-left text-gray-500 max-w-[300px] truncate`}
                      title={team.evaluation_prompt || ''}>
                      {isEditing ? (
                        <textarea value={editData.evaluation_prompt}
                          onChange={e => setEditData(p => ({ ...p, evaluation_prompt: e.target.value }))}
                          rows={2}
                          className="border border-gray-300 px-1.5 py-0.5 text-[12px] text-gray-700 w-full resize-y" />
                      ) : (team.evaluation_prompt || '-')}
                    </td>
                    <td className={`${TD} text-gray-500 whitespace-nowrap`}>
                      {team.created_at ? new Date(team.created_at).toLocaleDateString('ko-KR') : '-'}
                    </td>
                    <td className="border border-gray-300 text-center px-2">
                      {isEditing ? (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => saveEdit(team.id)}
                            className="bg-green-600 text-white px-2 py-0.5 text-[11px] hover:bg-green-700">저장</button>
                          <button onClick={cancelEdit}
                            className="bg-gray-400 text-white px-2 py-0.5 text-[11px] hover:bg-gray-500">취소</button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-center">
                          <button onClick={() => startEdit(team)}
                            className="bg-blue-600 text-white px-2 py-0.5 text-[11px] hover:bg-blue-700">수정</button>
                          <button onClick={() => handleDelete(team.id, team.name)}
                            className="bg-red-600 text-white px-2 py-0.5 text-[11px] hover:bg-red-700">삭제</button>
                        </div>
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
  )
}

/* ═══════════════════════════════ */
/*         직원 관리 탭            */
/* ═══════════════════════════════ */
function AgentManagement() {
  const [agents, setAgents] = useState([])
  const [teams, setTeams] = useState([])
  const [newAgent, setNewAgent] = useState({ phone_number: '', name: '', team_id: '' })
  const [savingTeam, setSavingTeam] = useState(null)

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

  const getTeamName = (teamId) => {
    if (!teamId) return null
    const team = teams.find(t => t.id === teamId)
    return team ? team.name : null
  }

  const handleAdd = async () => {
    if (!newAgent.phone_number.trim()) return
    try {
      const teamId = newAgent.team_id ? parseInt(newAgent.team_id) : null
      const teamName = teamId ? getTeamName(teamId) : null
      await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number: newAgent.phone_number,
          name: newAgent.name,
          team_id: teamId,
          team_name: teamName,
        }),
      })
      setNewAgent({ phone_number: '', name: '', team_id: '' })
      fetchData()
    } catch (err) {
      console.error('Failed to add agent:', err)
    }
  }

  const handleTeamChange = async (agent, newTeamId) => {
    const teamId = newTeamId ? parseInt(newTeamId) : null
    const teamName = teamId ? getTeamName(teamId) : null
    setSavingTeam(agent.phone_number)
    setAgents(prev => prev.map(a =>
      a.phone_number === agent.phone_number
        ? { ...a, team_id: teamId, team_name: teamName, resolved_team_name: teamName }
        : a
    ))
    try {
      await fetch(`/api/agents/${encodeURIComponent(agent.phone_number)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agent.name,
          team_id: teamId,
          team_name: teamName,
        }),
      })
    } catch (err) {
      console.error('Failed to update team:', err)
      fetchData()
    } finally {
      setSavingTeam(null)
    }
  }

  const handleDelete = async (phone, name) => {
    if (!confirm(`"${name || phone}" 직원을 삭제하시겠습니까?`)) return
    try {
      await fetch(`/api/agents/${encodeURIComponent(phone)}`, { method: 'DELETE' })
      fetchData()
    } catch (err) {
      console.error('Failed to delete agent:', err)
    }
  }

  return (
    <div className="space-y-2">
      {/* 새 직원 등록 폼 */}
      <div className="border border-gray-300">
        <div className="px-3 py-1.5" style={{ background: '#ECEBFF' }}>
          <span className="text-[12px] font-bold text-gray-700">새 직원 수동 등록</span>
          <span className="text-[10px] text-gray-500 ml-2">앱에서 가입한 직원은 자동으로 아래 목록에 표시됩니다.</span>
        </div>
        <div className="px-3 py-2 bg-white flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">전화번호</label>
            <input type="text" placeholder="01012345678"
              value={newAgent.phone_number}
              onChange={e => setNewAgent(p => ({ ...p, phone_number: e.target.value }))}
              className="border border-gray-300 px-2 py-1 text-[12px] text-gray-700 bg-white w-36" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">이름</label>
            <input type="text" placeholder="홍길동"
              value={newAgent.name}
              onChange={e => setNewAgent(p => ({ ...p, name: e.target.value }))}
              className="border border-gray-300 px-2 py-1 text-[12px] text-gray-700 bg-white w-28" />
          </div>
          <div>
            <label className="block text-[11px] text-gray-500 mb-0.5">소속 팀</label>
            <select value={newAgent.team_id}
              onChange={e => setNewAgent(p => ({ ...p, team_id: e.target.value }))}
              className="border border-gray-300 px-2 py-1 text-[12px] text-gray-700 bg-white w-36">
              <option value="">팀 미지정</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button onClick={handleAdd}
            className="bg-blue-600 text-white px-3 py-1 text-[11px] hover:bg-blue-700">
            등록
          </button>
        </div>
      </div>

      {/* 직원 목록 테이블 */}
      <div className="border border-gray-300">
        <div className="px-3 py-1.5 flex items-center justify-between" style={{ background: '#ECEBFF' }}>
          <span className="text-[12px] font-bold text-gray-700">등록된 직원</span>
          <span className="text-[11px] text-gray-500">{agents.length}명 | 소속 팀 변경 시 즉시 저장</span>
        </div>
        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className={TH} style={TH_STYLE}>No.</th>
              <th className={TH} style={TH_STYLE}>전화번호</th>
              <th className={TH} style={TH_STYLE}>이름</th>
              <th className={TH} style={TH_STYLE}>소속 팀</th>
              <th className={TH} style={TH_STYLE}>가입일</th>
              <th className={TH} style={TH_STYLE}>관리</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 ? (
              <tr>
                <td colSpan={6} className="border border-gray-300 text-center text-[12px] text-gray-400 py-6">
                  등록된 직원이 없습니다
                </td>
              </tr>
            ) : (
              agents.map((agent, idx) => {
                const currentTeamId = agent.team_id != null ? String(agent.team_id) : ''
                const isSaving = savingTeam === agent.phone_number
                return (
                  <tr key={agent.phone_number}
                    className={!agent.team_id ? 'bg-amber-50' : ''}
                    style={{ height: '28px' }}>
                    <td className={`${TD} text-gray-500`}>{idx + 1}</td>
                    <td className={`${TD} font-mono`}>{agent.phone_number}</td>
                    <td className={`${TD} font-medium`}>
                      {agent.name || <span className="text-gray-400 italic">이름 없음</span>}
                    </td>
                    <td className="border border-gray-300 text-center px-2">
                      <div className="flex items-center justify-center gap-1">
                        <select value={currentTeamId}
                          onChange={e => handleTeamChange(agent, e.target.value)}
                          disabled={isSaving}
                          className={`border px-1.5 py-0.5 text-[12px] w-32 ${
                            !agent.team_id
                              ? 'border-amber-300 bg-amber-50 text-amber-700'
                              : 'border-gray-300 bg-white text-gray-700'
                          } ${isSaving ? 'opacity-50' : ''}`}>
                          <option value="">팀 미지정</option>
                          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                        {isSaving && <span className="text-[10px] text-gray-400">저장중...</span>}
                      </div>
                    </td>
                    <td className={`${TD} text-gray-500 whitespace-nowrap`}>
                      {agent.created_at ? new Date(agent.created_at).toLocaleDateString('ko-KR') : '-'}
                    </td>
                    <td className="border border-gray-300 text-center px-2">
                      <button onClick={() => handleDelete(agent.phone_number, agent.name)}
                        className="bg-red-600 text-white px-2 py-0.5 text-[11px] hover:bg-red-700">
                        삭제
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ═══════════════════════════════ */
/*         메인 Settings           */
/* ═══════════════════════════════ */
export default function Settings() {
  const [activeTab, setActiveTab] = useState('teams')

  return (
    <div className="px-3 py-3" style={{ fontFamily: 'Pretendard, -apple-system, sans-serif' }}>

      {/* ── 탭 바 ── */}
      <div className="flex items-center gap-0 mb-2 border border-gray-300">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 text-[12px] font-bold border-r border-gray-300 last:border-r-0 transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}>
            {tab.label}
          </button>
        ))}
        <div className="flex-1 bg-gray-50" style={{ height: '30px' }} />
      </div>

      {activeTab === 'teams' && <TeamManagement />}
      {activeTab === 'agents' && <AgentManagement />}
    </div>
  )
}
