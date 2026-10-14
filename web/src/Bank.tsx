import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Plus,
  Upload,
  Download,
  Search,
  ArrowUp,
  ArrowDown,
  Trash2,
  GripVertical,
  Copy,
  Image,
  Music2,
  Film,
  Check,
  Monitor,
} from 'lucide-react'
import type { AdminProps } from './App'
import { kinds, uid, type Question, type Kind, type Media, type Config } from './types'
import { useMediaUpload } from './UploadCenter'
import { Empty, Modal, useNotice, useConfirm } from './ui'
import {
  recoverEditorDraft,
  editorDraftKey,
  editorDraftStorage,
  writeEditorDraft,
  clearEditorDraft,
  type EditorDraft,
} from './editorDraft'
import { Checkbox, Select } from './Controls'
import { QuestionPreview } from './QuestionPreview'
import { IllustrationEditor } from './IllustrationEditor'
import { WarmupAudioEditor } from './WarmupAudioEditor'
import { resolveWarmupAudioAppearance } from './warmupAudioAppearance'
import { useIllustrationEditing } from './useIllustrationEditing'
export default function Bank({ state, save, onDirtyChange }: AdminProps) {
  const notice = useNotice(),
    ask = useConfirm(),
    [recovered, setRecovered] = useState(recoverEditorDraft),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState(''),
    [draft, setDraft] = useState<Question | null>(null),
    [busy, setBusy] = useState(false),
    [deleteQ, setDelete] = useState(false),
    [link, setLink] = useState(''),
    [linkKind, setLinkKind] = useState<Media['kind']>('audio'),
    [importValue, setImport] = useState<Config | null>(null)
  const [dirty, setDirty] = useState(false),
    [previewMediaRequest, setPreviewMediaRequest] = useState<{ id: string; token: number }>(),
    [illustrationEpoch, setIllustrationEpoch] = useState(0),
    [draftRevision, setDraftRevision] = useState(state.configRevision),
    file = useRef<HTMLInputElement>(null),
    importFile = useRef<HTMLInputElement>(null),
    preview = useRef<HTMLElement>(null),
    editorScroll = useRef<HTMLDivElement>(null)
  const uploadContext = `${draft?.id}:${draft?.kind}:${illustrationEpoch}`
  const upload = useMediaUpload(uploadContext)
  const currentUploadContext = useRef(uploadContext)
  currentUploadContext.current = uploadContext
  const draftCache = useRef<EditorDraft | null>(null)
  draftCache.current =
    dirty && draft ? { question: draft, revision: draftRevision, updatedAt: Date.now() } : null
  const cacheWarning = useRef(false)
  const keepDraft = () => {
    if (!draftCache.current) return
    if (
      !writeEditorDraft(editorDraftStorage(), editorDraftKey(), draftCache.current) &&
      !cacheWarning.current
    ) {
      cacheWarning.current = true
      notice('本机草稿暂时无法保留，请及时保存页面', true)
    }
  }
  useEffect(() => {
    if (!dirty || !draft || recovered) return
    const timer = setTimeout(keepDraft, 150)
    return () => clearTimeout(timer)
  }, [dirty, draft, draftRevision, recovered])
  useEffect(() => {
    window.addEventListener('pagehide', keepDraft)
    return () => window.removeEventListener('pagehide', keepDraft)
  }, [])
  const questions = state.config.questions.filter(
    (q) =>
      (!filter || q.kind === filter) &&
      (q.title + q.body + q.source).toLowerCase().includes(query.toLowerCase()),
  )
  useEffect(() => {
    if (!dirty) {
      const latest =
        state.config.questions.find((q) => q.id === draft?.id) || state.config.questions[0]
      setDraft(latest ? structuredClone(latest) : null)
      setDraftRevision(state.configRevision)
    }
  }, [state.configRevision, draft?.id, dirty])
  const conflicted = dirty && draftRevision !== state.configRevision
  useEffect(() => setPreviewMediaRequest(undefined), [draft?.id])
  useLayoutEffect(() => {
    if (!draft) return
    // Selecting a page shows its rendered preview and resets the detail form.
    if (editorScroll.current) editorScroll.current.scrollTop = 0
    preview.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
  }, [draft?.id])
  useLayoutEffect(() => {
    onDirtyChange?.(dirty)
    return () => {
      onDirtyChange?.(false)
    }
  }, [dirty, onDirtyChange])
  async function edit(q: Question) {
    if (
      dirty &&
      !(await ask({
        title: '切换题目',
        message: `「${draft?.title || '当前页面'}」尚未保存。切换到「${q.title}」将放弃这些修改。`,
        confirmLabel: '放弃并切换',
        cancelLabel: '继续编辑',
        destructive: true,
      }))
    )
      return
    if (dirty) clearEditorDraft()
    setIllustrationEpoch((value) => value + 1)
    setDraft(structuredClone(q))
    setDraftRevision(state.configRevision)
    setDirty(false)
  }
  function update(v: Partial<Question>) {
    setDraft((q) => (q ? { ...q, ...v } : q))
    setDirty(true)
  }
  const illustrationEditing = useIllustrationEditing(draft, illustrationEpoch, (illustrations, pageId) => {
    setDraft((current) => current?.id === pageId ? { ...current, illustrations } : current)
    setDirty(true)
  })
  const newPage = async () => {
    if (
      dirty &&
      !(await ask({
        title: '新建页面',
        message: '当前页面尚未保存。新建页面将放弃这些修改。',
        confirmLabel: '放弃并新建',
        cancelLabel: '继续编辑',
        destructive: true,
      }))
    )
      return
    if (dirty) clearEditorDraft()
    setIllustrationEpoch((value) => value + 1)
    setDraftRevision(state.configRevision)
    setDraft({
      id: uid(),
      kind: 'intro',
      section: '开场',
      title: '新页面',
      body: '',
      options: ['', '', '', ''],
      answer: '',
      explanation: '',
      points: 1,
      wrongPoints: 0,
      playerPoints: 1,
      playerWrongPoints: 0,
      duration: 30,
      enabled: true,
      media: [],
      source: '',
      review: '',
    })
    setDirty(true)
  }
  async function persist() {
    if (!draft) return
    setBusy(true)
    const qs = [...state.config.questions],
      i = qs.findIndex((q) => q.id === draft.id)
    if (i < 0 && draft.kind === 'warmup') qs.unshift(draft)
    else if (i < 0) qs.push(draft)
    else qs[i] = draft
    const ok = await save({ ...state.config, questions: qs }, draftRevision)
    if (ok) {
      clearEditorDraft()
      setDirty(false)
    }
    setBusy(false)
  }
  async function move(q: Question, delta: number) {
    const qs = [...state.config.questions],
      i = qs.findIndex((v) => v.id === q.id),
      j = i + delta
    if (j < 0 || j >= qs.length) return
    ;[qs[i], qs[j]] = [qs[j], qs[i]]
    const ok = await save({ ...state.config, questions: qs })
    if (ok && draftRevision === state.configRevision) setDraftRevision(state.configRevision + 1)
  }
  async function attach(files: FileList | null) {
    if (!files || !draft || busy) return
    const targetId = draft.id
    const targetContext = uploadContext
    setBusy(true)
    try {
      for (const f of Array.from(files)) {
        if (currentUploadContext.current !== targetContext) break
        const media = await upload(f)
        if (currentUploadContext.current !== targetContext) break
        setDraft((current) => current?.id === targetId ? { ...current, media: [...current.media, media] } : current)
        setDirty(true)
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') notice((e as Error).message, true)
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }
  async function importJSON(f: File | undefined) {
    if (!f) return
    try {
      const v = JSON.parse(await f.text())
      setImport(v.config || v)
    } catch {
      notice('无法读取 JSON 题库', true)
    } finally {
      if (importFile.current) importFile.current.value = ''
    }
  }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(state.config, null, 2)], { type: 'application/json' }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a')
    a.href = url
    a.download = '冬日茶话会-题库.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  const mediaUpdate = (id: string, value: Partial<Media>) => {
    setDraft((current) => current ? {
      ...current,
      media: current.media.map((m) => m.id === id ? { ...m, ...value } : m),
    } : current)
    setDirty(true)
  }
  const moveMedia = (id: string, step: number) => {
    setDraft((current) => {
      if (!current) return current
      const media = [...current.media]
      const index = media.findIndex((item) => item.id === id)
      const next = index + step
      if (index < 0 || next < 0 || next >= media.length) return current
      ;[media[index], media[next]] = [media[next], media[index]]
      return { ...current, media }
    })
    setDirty(true)
  }
  return (
    <>
      <div className="page-actions">
        <span className="muted">
          {state.config.questions.length} 个页面 ·{' '}
          {state.config.questions.filter((q) => q.enabled).length} 个启用 ·{' '}
          {state.config.questions.filter((q) => q.review).length} 个待核对
        </span>
        <div>
          <input
            hidden
            type="file"
            aria-label="导入题库文件"
            accept=".json"
            ref={importFile}
            onChange={(e) => importJSON(e.target.files?.[0])}
          />
          <button onClick={() => importFile.current?.click()}>
            <Upload size={17} />
            导入题库
          </button>
          <button onClick={exportJSON}>
            <Download size={17} />
            导出题库
          </button>
          <button className="primary" onClick={newPage}>
            <Plus size={18} />
            新建页面
          </button>
        </div>
      </div>
      {draft && (
        <section className="bank-preview-row" ref={preview} aria-label="所选页面渲染预览">
          <QuestionPreview
            key={draft.id}
            state={state}
            draft={draft}
            dirty={dirty}
            mediaRequest={previewMediaRequest}
            illustrationEditing={illustrationEditing}
          />
        </section>
      )}
      <div className="bank-layout">
        <section className="question-list-panel">
          <div className="list-filters">
            <label className="search">
              <Search size={19} />
              <input
                aria-label="搜索题目"
                placeholder="搜索题目…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <Select
              label="筛选页面类型"
              value={filter}
              onValueChange={setFilter}
              options={[
                { value: '', label: '全部类型' },
                ...Object.entries(kinds).map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
          <div className="question-list">
            {questions.map((q) => {
              const i = state.config.questions.indexOf(q)
              return (
                <div
                  key={q.id}
                  className={'question-row ' + (draft?.id === q.id ? 'selected' : '')}
                >
                  <button className="question-select" onClick={() => edit(q)}>
                    <GripVertical size={15} />
                    <span className="row-number">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{q.title}</strong>
                      <small>
                        <span className={'kind kind-' + q.kind}>{kinds[q.kind]}</span>
                        {q.review && <span className="review">待核对</span>}
                      </small>
                    </div>
                  </button>
                  <span className="points">+{q.points}</span>
                  <button
                    className={'toggle ' + (q.enabled ? 'on' : '')}
                    role="switch"
                    aria-checked={q.enabled}
                    aria-label={(q.enabled ? '禁用' : '启用') + ' ' + q.title}
                    onClick={async () => {
                      const ok = await save({
                        ...state.config,
                        questions: state.config.questions.map((v) =>
                          v.id === q.id ? { ...v, enabled: !v.enabled } : v,
                        ),
                      })
                      if (ok && draftRevision === state.configRevision)
                        setDraftRevision(state.configRevision + 1)
                      if (ok && draft?.id === q.id)
                        setDraft((v) => (v ? { ...v, enabled: !q.enabled } : v))
                    }}
                  />
                  <div className="reorder">
                    <button
                      aria-label={'上移 ' + q.title}
                      disabled={i === 0}
                      onClick={() => move(q, -1)}
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      aria-label={'下移 ' + q.title}
                      disabled={i === state.config.questions.length - 1}
                      onClick={() => move(q, 1)}
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
            {questions.length === 0 && <Empty>没有匹配的页面</Empty>}
          </div>
          <div className="list-help">↑ ↓ 调整顺序 · 点击编辑 · 禁用页不会进入投影</div>
        </section>
        <section className="editor-panel" aria-label="页面编辑器">
          {draft ? (
            <>
              <div className="panel-title">
                <h2>编辑页面</h2>
                <small>{dirty ? '有未保存修改' : draft.source ? 'PPT 原题' : '自定义页面'}</small>
                <button
                  className="small"
                  onClick={() =>
                    preview.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
                  }
                >
                  <ArrowUp size={15} />
                  查看预览
                </button>
              </div>
              <div
                className="editor-scroll"
                ref={editorScroll}
                role="region"
                aria-label="页面详细信息"
                tabIndex={0}
              >
                {draft.review && <div className="review-note">{draft.review}</div>}
                {conflicted && (
                  <div className="review-note">
                    题库已在其他窗口修改，当前草稿尚未保存。
                    <button
                      onClick={() => {
                        const latest = state.config.questions.find((q) => q.id === draft.id)
                        if (latest) edit(latest)
                        else {
                          setDraftRevision(state.configRevision)
                          notice('已采用最新题库版本，请检查后保存新页面')
                        }
                      }}
                    >
                      {state.config.questions.some((q) => q.id === draft.id)
                        ? '重新载入此页'
                        : '采用最新题库版本'}
                    </button>
                  </div>
                )}
                <div className="editor-form">
                  <label>
                    页面标题
                    <input
                      value={draft.title}
                      onChange={(e) => update({ title: e.target.value })}
                      maxLength={400}
                    />
                  </label>
                  <div className="form-pair">
                    <label>
                      页面类型
                      <Select
                        label="页面类型"
                        value={draft.kind}
                        onValueChange={(value) =>
                          update({
                            kind: value as Kind,
                            presentation: value === 'intro' ? draft.presentation : '',
                            illustrations: value === 'intro' ? draft.illustrations : undefined,
                            section: kinds[value as Kind],
                            answer: '',
                            options: draft.options.length >= 2 ? draft.options : ['', '', '', ''],
                            ...(value === 'warmup'
                              ? {
                                  points: 0,
                                  wrongPoints: 0,
                                  playerPoints: 0,
                                  playerWrongPoints: 0,
                                  duration: 0,
                                  media: draft.media.map((m) => ({ ...m, answerOnly: false })),
                                }
                              : {}),
                          })
                        }
                        options={Object.entries(kinds).map(([value, label]) => ({
                          value,
                          label,
                        }))}
                      />
                    </label>
                    <label>
                      流程组别
                      <input
                        aria-label="流程组别"
                        value={draft.section}
                        onChange={(e) => update({ section: e.target.value })}
                      />
                    </label>
                  </div>
                  {draft.kind === 'intro' && (
                    <label>
                      页面呈现
                      <Select
                        label="页面呈现"
                        value={draft.presentation || 'normal'}
                        options={[
                          { value: 'normal', label: '普通说明页' },
                          { value: 'logos', label: 'Logo 集结 · 开场动画' },
                        ]}
                        onValueChange={(value) =>
                          update({ presentation: value === 'logos' ? 'logos' : '' })
                        }
                      />
                    </label>
                  )}
                  {draft.id === 'welcome' && draft.kind === 'intro' && (
                    <fieldset className="welcome-display-settings">
                      <legend>开场页显示</legend>
                      <Checkbox checked={draft.welcomeShowScores !== false} onCheckedChange={(welcomeShowScores) => update({ welcomeShowScores })}>显示团队比分</Checkbox>
                      <Checkbox checked={draft.welcomeShowTimer !== false} onCheckedChange={(welcomeShowTimer) => update({ welcomeShowTimer })}>显示倒计时</Checkbox>
                      <p className="media-help">仅影响本页；团队比分同时遵循活动的全局比分开关。保存页面后投影生效。</p>
                    </fieldset>
                  )}
                  <label>
                    {draft.kind === 'warmup' ? '暖场提示' : '题目内容'}
                    <textarea
                      value={draft.body}
                      onChange={(e) => update({ body: e.target.value })}
                      rows={4}
                    />
                  </label>
                  {draft.kind === 'choice' && (
                    <>
                      <fieldset className="option-edit">
                        <legend>选项设置</legend>
                        {draft.options.map((o, i) => (
                          <label key={i}>
                            <span>{String.fromCharCode(65 + i)}</span>
                            <input
                              aria-label={'选项 ' + String.fromCharCode(65 + i)}
                              value={o}
                              onChange={(e) =>
                                update({
                                  options: draft.options.map((v, j) =>
                                    j === i ? e.target.value : v,
                                  ),
                                })
                              }
                            />
                            {draft.options.length > 2 && (
                              <button
                                className="icon-btn"
                                aria-label={'删除选项 ' + String.fromCharCode(65 + i)}
                                onClick={() =>
                                  update({
                                    options: draft.options.filter((_, j) => j !== i),
                                    answer: '',
                                  })
                                }
                              >
                                <XIcon />
                              </button>
                            )}
                          </label>
                        ))}
                        {draft.options.length < 8 && (
                          <button
                            className="subtle"
                            onClick={() => update({ options: [...draft.options, ''] })}
                          >
                            <Plus size={14} />
                            添加选项
                          </button>
                        )}
                      </fieldset>
                      <label>
                        正确答案
                        <Select
                          label="正确答案"
                          value={draft.answer}
                          onValueChange={(answer) => update({ answer })}
                          options={[
                            { value: '', label: '请选择答案' },
                            ...draft.options.map((o, i) => ({
                              value: String.fromCharCode(65 + i),
                              label: `${String.fromCharCode(65 + i)} · ${o || '未填写'}`,
                            })),
                          ]}
                        />
                      </label>
                    </>
                  )}
                  {(draft.kind === 'soup' || draft.kind === 'song' || draft.kind === 'draw') && (
                    <label>
                      正确答案
                      <input
                        value={draft.answer}
                        onChange={(e) => update({ answer: e.target.value })}
                      />
                    </label>
                  )}
                  {draft.kind !== 'warmup' && (
                    <>
                      <div className="form-pair">
                        <label>
                          团队答对加分
                          <input
                            type="number"
                            min={0}
                            max={1000000}
                            value={draft.points}
                            onChange={(e) => update({ points: Number(e.target.value) })}
                          />
                        </label>
                        <label>
                          团队答错扣分
                          <input
                            type="number"
                            min={-1000000}
                            max={0}
                            value={draft.wrongPoints}
                            onChange={(e) => update({ wrongPoints: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                      <div className="form-pair">
                        <label>
                          个人答对加分
                          <input
                            type="number"
                            min={0}
                            max={1000000}
                            value={draft.playerPoints || 0}
                            onChange={(e) => update({ playerPoints: Number(e.target.value) })}
                          />
                        </label>
                        <label>
                          个人答错扣分
                          <input
                            type="number"
                            min={-1000000}
                            max={0}
                            value={draft.playerWrongPoints || 0}
                            onChange={(e) => update({ playerWrongPoints: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                      <label>
                        倒计时（秒，0 表示不用计时）
                        <input
                          type="number"
                          min={0}
                          max={86400}
                          value={draft.duration}
                          onChange={(e) => update({ duration: Number(e.target.value) })}
                        />
                      </label>
                    </>
                  )}
                  {illustrationEditing && (
                    <IllustrationEditor
                      key={illustrationEditing.sessionKey}
                      items={draft.illustrations || []}
                      editing={illustrationEditing}
                      recommended={draft.id === 'welcome'}
                    />
                  )}
                  {draft.kind === 'warmup' && (
                    <WarmupAudioEditor
                      key={uploadContext}
                      context={uploadContext}
                      value={draft.warmupAudio}
                      onChange={(patch) => {
                        if (currentUploadContext.current !== uploadContext) return
                        const pageId = draft.id
                        setDraft((current) => current?.id === pageId ? {
                          ...current,
                          warmupAudio: { cover: '', background: '', ...current.warmupAudio, ...patch },
                        } : current)
                        setDirty(true)
                      }}
                    />
                  )}
                  <fieldset className="media-edit">
                    <legend>{draft.kind === 'warmup' ? '暖场音视频清单' : '媒体素材'}</legend>
                    {draft.kind === 'warmup' && (
                      <p className="media-help">
                        上传音频或视频，在现场控制中分区切换播放；上下箭头调整顺序。
                      </p>
                    )}
                    <input
                      ref={file}
                      type="file"
                      hidden
                      aria-label={draft.kind === 'warmup' ? '上传暖场音视频' : '上传媒体素材'}
                      multiple
                      accept={
                        draft.kind === 'warmup'
                          ? 'audio/*,video/*'
                          : 'image/png,image/jpeg,image/gif,image/webp,audio/*,video/*'
                      }
                      onChange={(e) => attach(e.target.files)}
                    />
                    <button
                      className="upload-zone"
                      disabled={busy}
                      onClick={() => file.current?.click()}
                    >
                      <Upload size={23} />
                      <strong>
                        {busy
                          ? '正在上传…'
                          : draft.kind === 'warmup'
                            ? '上传暖场音频或视频'
                            : '上传图片、音频或视频'}
                      </strong>
                      <small>视频最大 3 GB · 图片／音频最大 256 MB · 上传后保存页面</small>
                    </button>
                    {draft.media.map((m, i) => (
                      <div key={m.id} className="media-item">
                        <div className="media-item-title">
                          {m.kind === 'image' ? (
                            <Image size={17} />
                          ) : m.kind === 'audio' ? (
                            <Music2 size={17} />
                          ) : (
                            <Film size={17} />
                          )}
                          <span>
                            {m.kind === 'image' ? '图片' : m.kind === 'audio' ? '音频' : '视频'}{' '}
                            {i + 1}
                          </span>
                          <a href={m.url} target="_blank" rel="noreferrer">
                            预览
                          </a>
                          <button
                            className="icon-btn"
                            aria-label={`上移素材 ${i + 1}`}
                            disabled={i === 0}
                            onClick={() => moveMedia(m.id, -1)}
                          >
                            <ArrowUp size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            aria-label={`下移素材 ${i + 1}`}
                            disabled={i === draft.media.length - 1}
                            onClick={() => moveMedia(m.id, 1)}
                          >
                            <ArrowDown size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            aria-label={`删除素材 ${i + 1}`}
                            onClick={() => {
                              setDraft((current) => current ? {
                                ...current,
                                media: current.media.filter((item) => item.id !== m.id),
                              } : current)
                              setDirty(true)
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        {m.kind === 'image' && (
                          <img className="media-thumb" src={m.url} alt={`素材 ${i + 1}`} />
                        )}
                        <label>
                          素材名称
                          <input
                            value={m.name || ''}
                            maxLength={150}
                            placeholder={`为${m.kind === 'video' ? '视频' : '素材'}起个名字`}
                            onChange={(e) => mediaUpdate(m.id, { name: e.target.value })}
                          />
                        </label>
                        {draft.kind !== 'warmup' && (
                          <Checkbox
                            checked={m.answerOnly}
                            onCheckedChange={(answerOnly) => mediaUpdate(m.id, { answerOnly })}
                          >
                            仅揭晓后显示
                          </Checkbox>
                        )}
                        {m.kind !== 'image' && (
                          <div className="form-pair">
                            <label>
                              开始秒数
                              <input
                                type="number"
                                min={0}
                                step="0.1"
                                value={m.start}
                                onChange={(e) =>
                                  mediaUpdate(m.id, { start: Number(e.target.value) })
                                }
                              />
                            </label>
                            <label>
                              结束秒数（0 至结尾）
                              <input
                                type="number"
                                min={0}
                                step="0.1"
                                value={m.end}
                                onChange={(e) => mediaUpdate(m.id, { end: Number(e.target.value) })}
                              />
                            </label>
                          </div>
                        )}
                        {draft.kind === 'warmup' && m.kind === 'audio' && (
                          <details className="warmup-track-artwork">
                            <summary>
                              <span>本曲 CD 与背景</span>
                              <small>
                                {m.warmupAudio?.cover && m.warmupAudio?.background
                                  ? '封面与背景已自定义'
                                  : m.warmupAudio?.cover
                                    ? '封面已自定义 · 背景使用默认'
                                    : m.warmupAudio?.background
                                      ? '封面使用默认 · 背景已自定义'
                                      : '使用默认设计'}
                              </small>
                            </summary>
                            <div className="warmup-track-artwork-preview-action">
                              <small>未单独设置的封面或背景使用默认。</small>
                              <button
                                type="button"
                                className="small"
                                onClick={() => {
                                  setPreviewMediaRequest((request) => ({
                                    id: m.id,
                                    token: (request?.token || 0) + 1,
                                  }))
                                  preview.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                                }}
                              >
                                <Monitor size={15} />
                                预览本曲
                              </button>
                            </div>
                            <WarmupAudioEditor
                              key={`${uploadContext}:${m.id}`}
                              context={`${uploadContext}:${m.id}`}
                              scope="track"
                              value={m.warmupAudio}
                              fallback={resolveWarmupAudioAppearance(draft.warmupAudio)}
                              onChange={(patch) => {
                                if (currentUploadContext.current !== uploadContext) return
                                const pageId = draft.id
                                const mediaId = m.id
                                setDraft((current) => current?.id === pageId ? {
                                  ...current,
                                  media: current.media.map((item) => item.id === mediaId ? {
                                    ...item,
                                    warmupAudio: { cover: '', background: '', ...item.warmupAudio, ...patch },
                                  } : item),
                                } : current)
                                setDirty(true)
                              }}
                            />
                          </details>
                        )}
                      </div>
                    ))}
                    <details className="remote-media">
                      <summary>使用在线媒体链接</summary>
                      <div className="remote-row">
                        <Select
                          label="链接素材类型"
                          value={draft.kind === 'warmup' && linkKind === 'image' ? 'audio' : linkKind}
                          onValueChange={(value) => setLinkKind(value as Media['kind'])}
                          options={[
                            { value: 'audio', label: '音频' },
                            { value: 'video', label: '视频' },
                            ...(draft.kind === 'warmup' ? [] : [{ value: 'image', label: '图片' }]),
                          ]}
                        />
                        <input
                          aria-label="媒体链接"
                          placeholder="https://… 直接文件链接"
                          value={link}
                          onChange={(e) => setLink(e.target.value)}
                        />
                        <button
                          disabled={!link.trim()}
                          onClick={() => {
                            const added: Media = {
                              id: uid(),
                              kind: draft.kind === 'warmup' && linkKind === 'image' ? 'audio' : linkKind,
                              url: link.trim(),
                              start: 0,
                              end: 0,
                              answerOnly: false,
                            }
                            setDraft((current) => current ? {
                              ...current,
                              media: [...current.media, added],
                            } : current)
                            setDirty(true)
                            setLink('')
                          }}
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                      <small>播放器需要可直接访问的文件；B 站等网页链接不能直接播放。</small>
                    </details>
                  </fieldset>
                  {draft.kind !== 'warmup' && (
                    <label>
                      答案解析
                      <textarea
                        value={draft.explanation}
                        onChange={(e) => update({ explanation: e.target.value })}
                        rows={4}
                      />
                    </label>
                  )}
                  <Checkbox
                    checked={draft.enabled}
                    onCheckedChange={(enabled) => update({ enabled })}
                  >
                    加入活动播放流程
                  </Checkbox>
                  {draft.review && (
                    <button className="subtle" onClick={() => update({ review: '' })}>
                      <Check size={16} />
                      标记已核对
                    </button>
                  )}
                  {draft.source && <small className="source">来源：{draft.source}</small>}
                </div>
              </div>
              <div className="editor-actions">
                <button className="primary" disabled={busy || conflicted} onClick={persist}>
                  保存修改
                </button>
                <button
                  aria-label="复制页面"
                  onClick={() => {
                    setDraft({ ...draft, id: uid(), title: draft.title + '（副本）', source: '' })
                    setDirty(true)
                  }}
                >
                  <Copy size={17} />
                </button>
                <button className="danger" onClick={() => setDelete(true)}>
                  <Trash2 size={17} />
                  删除页面
                </button>
              </div>
            </>
          ) : (
            <Empty>选择页面或新建页面</Empty>
          )}
        </section>
      </div>
      {recovered && (
        <Modal title="恢复未保存的草稿" onClose={() => setRecovered(null)}>
          <p>
            本机保留了「{recovered.question.title || '新页面'}
            」的未保存修改，包含立绘位置和媒体设置。恢复后可继续编辑，再保存到题库。
          </p>
          <p>草稿时间：{new Date(recovered.updatedAt).toLocaleString('zh-CN')}</p>
          <div className="modal-actions">
            <button data-autofocus onClick={() => setRecovered(null)}>
              暂不恢复
            </button>
            <button
              className="primary"
              onClick={() => {
                setIllustrationEpoch((value) => value + 1)
                setDraft(structuredClone(recovered.question))
                setDraftRevision(recovered.revision)
                setDirty(true)
                setRecovered(null)
              }}
            >
              恢复编辑
            </button>
          </div>
        </Modal>
      )}
      {deleteQ && draft && (
        <Modal title="删除页面" onClose={() => setDelete(false)}>
          <p>将删除「{draft.title}」。已有计分记录保留，可在计分页撤销。</p>
          <div className="modal-actions">
            <button onClick={() => setDelete(false)}>取消</button>
            <button
              className="danger"
              onClick={async () => {
                const ok = await save({
                  ...state.config,
                  questions: state.config.questions.filter((q) => q.id !== draft.id),
                })
                if (ok) {
                  clearEditorDraft()
                  setDraft(null)
                  setDirty(false)
                  setDelete(false)
                }
              }}
            >
              确认删除
            </button>
          </div>
        </Modal>
      )}
      {importValue && (
        <Modal title="导入题库" onClose={() => setImport(null)}>
          <p>
            用所选文件替换题目、组别和活动设置。已有计分记录会保留；抽签设置改变后，抽签历史会清空。
          </p>
          <p>建议先导出当前题库备份。文件里的媒体地址需在本机或网络上可访问。</p>
          <div className="modal-actions">
            <button onClick={() => setImport(null)}>取消</button>
            <button
              className="primary"
              onClick={async () => {
                if (await save(importValue)) {
                  clearEditorDraft()
                  setImport(null)
                  setDraft(null)
                  setDirty(false)
                }
              }}
            >
              确认导入
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
function XIcon() {
  return <span className="remove-letter">×</span>
}
