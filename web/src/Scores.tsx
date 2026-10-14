import { useEffect, useState } from 'react'
import { Plus, Users, Trash2, RotateCcw, Download, Check, Save, Trophy } from 'lucide-react'
import type { AdminProps } from './App'
import { teamScore, uid, type Team } from './types'
import { Empty, Modal, useNotice } from './ui'
import { Select } from './Controls'
export default function Scores({ state, save, action }: AdminProps) {
  const notice = useNotice(),
    [teams, setTeams] = useState<Team[]>(structuredClone(state.config.teams)),
    [selected, setSelected] = useState(state.config.teams[0]?.id || ''),
    [delta, setDelta] = useState(1),
    [playerDelta, setPlayerDelta] = useState(0),
    [player, setPlayer] = useState(''),
    [note, setNote] = useState(''),
    [confirmClear, setClear] = useState(false)
  useEffect(() => setTeams(structuredClone(state.config.teams)), [state.configRevision])
  useEffect(() => {
    if (!state.config.teams.some((t) => t.id === selected))
      setSelected(state.config.teams[0]?.id || '')
  }, [state.config.teams, selected])
  const players = new Map<string, { name: string; teamId: string; score: number }>()
  for (const s of state.scores) {
    if (s.player) {
      const key = JSON.stringify([s.teamId, s.player]),
        v = players.get(key) || { name: s.player, teamId: s.teamId, score: 0 }
      v.score += s.playerDelta || 0
      players.set(key, v)
    }
  }
  const ranking = [...players.values()].sort((a, b) => b.score - a.score)
  const exportCSV = () => {
    const cell = (v: string | number) =>
      '"' +
      (typeof v === 'string' && /^[=+@-]/.test(v) ? '\t' : '') +
      String(v).replaceAll('"', '""') +
      '"'
    const rows = [
      ['时间', '组别', '题目 / 备注', '答题者', '团队分数', '个人分数'],
      ...state.scores.map((s) => [
        new Date(s.at).toLocaleString(),
        state.config.teams.find((t) => t.id === s.teamId)?.name || s.teamId,
        s.note,
        s.player,
        s.delta,
        s.playerDelta || 0,
      ]),
    ]
    const url = URL.createObjectURL(
        new Blob(['\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\n')], {
          type: 'text/csv;charset=utf-8',
        }),
      ),
      a = document.createElement('a')
    a.href = url
    a.download = '茶话会-计分记录.csv'
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <>
      <div className="page-actions">
        <span className="muted">分数由判分与手动记录自动合计 · 重复判分覆盖本题结果</span>
        <div>
          <button onClick={exportCSV}>
            <Download size={17} />
            导出成绩
          </button>
          <button className="danger" disabled={!state.scores.length} onClick={() => setClear(true)}>
            <RotateCcw size={17} />
            清空积分
          </button>
        </div>
      </div>
      <div className="scores-layout">
        <div>
          <section className="panel">
            <div className="panel-title">
              <h2>
                <Users size={21} />
                组别管理
              </h2>
              <button
                className="small"
                onClick={() =>
                  setTeams((v) => [
                    ...v,
                    {
                      id: uid(),
                      name: `第 ${v.length + 1} 组`,
                      color: ['#ce7180', '#347cc1', '#3e9a73', '#9565b3'][v.length % 4],
                    },
                  ])
                }
              >
                <Plus size={16} />
                添加组别
              </button>
            </div>
            <div className="teams-editor">
              {teams.map((t, i) => (
                <div className="team-edit-row" key={t.id}>
                  <input
                    type="color"
                    aria-label={`组别 ${i + 1} 颜色`}
                    value={t.color}
                    onChange={(e) =>
                      setTeams((v) =>
                        v.map((x) => (x.id === t.id ? { ...x, color: e.target.value } : x)),
                      )
                    }
                  />
                  <input
                    aria-label={`组别 ${i + 1} 名称`}
                    value={t.name}
                    onChange={(e) =>
                      setTeams((v) =>
                        v.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)),
                      )
                    }
                  />
                  <strong>
                    {teamScore(state, t.id)}
                    <small> 分</small>
                  </strong>
                  <button
                    className="icon-btn"
                    aria-label={'删除组别 ' + t.name}
                    onClick={() => setTeams((v) => v.filter((x) => x.id !== t.id))}
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
            <div className="panel-bottom">
              <small>已有计分的组别，请先撤销其记录再删除。</small>
              <button className="primary" onClick={() => save({ ...state.config, teams })}>
                <Save size={16} />
                保存组别
              </button>
            </div>
          </section>
          <section className="panel ledger-panel">
            <div className="panel-title">
              <h2>
                <RotateCcw size={20} />
                计分记录
              </h2>
              <small>{state.scores.length} 条记录</small>
            </div>
            {state.scores.length ? (
              <div className="ledger-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>组别 / 答题者</th>
                      <th>题目与备注</th>
                      <th>团队 / 个人</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...state.scores].reverse().map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>
                            {state.config.teams.find((t) => t.id === s.teamId)?.name || s.teamId}
                          </strong>
                          <small>
                            {s.player || '团队计分'} ·{' '}
                            {new Date(s.at).toLocaleTimeString('zh-CN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </small>
                        </td>
                        <td>
                          {s.note || '手动调整'}
                          <small>
                            {s.questionId ? (s.correct ? '判定正确' : '判定错误') : '手动调整'}
                          </small>
                        </td>
                        <td className={s.delta >= 0 ? 'positive' : 'negative'}>
                          {s.delta > 0 ? '+' : ''}
                          {s.delta}
                          <small>
                            {s.player
                              ? (s.playerDelta > 0 ? '+' : '') + (s.playerDelta || 0) + ' 个人分'
                              : '—'}
                          </small>
                        </td>
                        <td>
                          <button
                            className="text-btn"
                            onClick={() => action({ op: 'undo', id: s.id })}
                          >
                            撤销
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>还没有计分记录，精彩即将开始。</Empty>
            )}
          </section>
        </div>
        <aside>
          <section className="panel manual-score">
            <div className="panel-title">
              <h2>
                <Plus size={20} />
                手动记分
              </h2>
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                if (
                  await action({
                    op: 'adjust',
                    teamId: selected,
                    delta,
                    playerDelta: player ? playerDelta : 0,
                    player,
                    note,
                  })
                ) {
                  notice('分数已记录')
                  setNote('')
                }
              }}
            >
              <label>
                记分组别
                <Select
                  label="记分组别"
                  value={selected}
                  onValueChange={setSelected}
                  required
                  placeholder="选择组别"
                  options={state.config.teams.map((t) => ({ value: t.id, label: t.name }))}
                />
              </label>
              <label>
                团队分数调整
                <input
                  type="number"
                  min={-1000000}
                  max={1000000}
                  value={delta}
                  onChange={(e) => setDelta(Number(e.target.value))}
                  required
                />
              </label>
              <div className="quick-points">
                {[-1, 1, 3, 5, 7, 8].map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={delta === n ? 'chosen' : ''}
                    onClick={() => setDelta(n)}
                  >
                    {n > 0 ? '+' : ''}
                    {n}
                  </button>
                ))}
              </div>
              <label>
                答题者昵称
                <input
                  value={player}
                  onChange={(e) => setPlayer(e.target.value)}
                  placeholder="可选，计入个人积分"
                  maxLength={60}
                />
              </label>
              <label>
                个人分数调整
                <input
                  type="number"
                  min={-1000000}
                  max={1000000}
                  value={playerDelta}
                  disabled={!player.trim()}
                  onChange={(e) => setPlayerDelta(Number(e.target.value))}
                />
              </label>
              <label>
                记分备注
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="例如：海龟汤第二轮，补加 5 分"
                  rows={3}
                />
              </label>
              <button
                className="primary"
                disabled={!selected || (delta === 0 && (!player.trim() || playerDelta === 0))}
              >
                <Check size={17} />
                记录分数
              </button>
            </form>
          </section>
          <section className="panel player-ranking">
            <div className="panel-title">
              <h2>
                <Trophy size={19} />
                个人积分
              </h2>
            </div>
            {ranking.length ? (
              <ol>
                {ranking.map((p, i) => (
                  <li key={JSON.stringify([p.teamId, p.name])}>
                    <span>{i + 1}</span>
                    <div>
                      <strong>{p.name}</strong>
                      <small>{state.config.teams.find((t) => t.id === p.teamId)?.name}</small>
                    </div>
                    <b>
                      {p.score}
                      <small> 分</small>
                    </b>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>判分或手动记分时填写昵称，即可记录个人积分。</Empty>
            )}
          </section>
        </aside>
      </div>
      {confirmClear && (
        <Modal title="清空积分" onClose={() => setClear(false)}>
          <p>所有组别和个人积分归零，同时清空计分记录。建议先导出成绩。</p>
          <div className="modal-actions">
            <button onClick={() => setClear(false)}>取消</button>
            <button
              className="danger"
              onClick={async () => {
                if (await action({ op: 'clearScores' })) setClear(false)
              }}
            >
              确认清空
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
