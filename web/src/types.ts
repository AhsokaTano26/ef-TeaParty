export type Kind = 'warmup' | 'intro' | 'choice' | 'soup' | 'song' | 'draw' | 'score'
export interface Media {
  id: string
  name?: string
  kind: 'image' | 'audio' | 'video'
  url: string
  start: number
  end: number
  answerOnly: boolean
  warmupAudio?: WarmupAudioAppearance
  netease?: { songId: string }
}
export interface Question {
  id: string
  kind: Kind
  section: string
  title: string
  body: string
  options: string[]
  answer: string
  explanation: string
  points: number
  wrongPoints: number
  playerPoints: number
  playerWrongPoints: number
  duration: number
  enabled: boolean
  media: Media[]
  source: string
  review: string
  presentation?: 'logos' | ''
  illustrations?: Illustration[]
  welcomeShowScores?: boolean
  welcomeShowTimer?: boolean
  warmupAudio?: WarmupAudioAppearance
}
export interface WarmupAudioAppearance {
  cover: string
  background: string
}
export interface Illustration {
  id: string
  url: string
  name: string
  x: number
  y: number
  width: number
  layer: 'behind' | 'front'
  flipped: boolean
  locked?: boolean
}
export interface Team {
  id: string
  name: string
  color: string
  score?: number
}
export interface Settings {
  title: string
  subtitle: string
  background: string
  showScores: boolean
}
export interface LotteryConfig {
  mode: 'names' | 'numbers'
  names: string[]
  min: number
  max: number
  count: number
  noRepeat: boolean
}
export interface Config {
  settings: Settings
  teams: Team[]
  questions: Question[]
  lottery: LotteryConfig
}
export interface Session {
  currentId: string
  revealed: boolean
  media: {
    status: string
    position: number
    updatedAt: number
    index: number
    seq: number
    rate?: number
  }
  timer: { remaining: number; deadline: number; duration?: number }
  lotteryVisible: boolean
  lotteryIntro?: boolean
  videoFullscreen: boolean
  presentationStartedAt?: number
}
export interface Score {
  id: string
  teamId: string
  questionId?: string
  correct: boolean
  delta: number
  playerDelta: number
  player: string
  note: string
  at: number
}
export interface Draw {
  id: string
  mode: string
  values: string[]
  at: number
  revealAt?: number
}
export interface LotteryView {
  phase: 'intro' | 'rolling' | 'result'
  mode: 'names' | 'numbers'
  count: number
  min: number
  max: number
  candidates: string[]
  used: string[]
  drawId: string
  startedAt: number
  revealAt: number
  landingValues?: string[]
}
export interface State {
  config: Config
  session: Session
  scores: Score[]
  draws: Draw[]
  revision: number
  configRevision: number
  serverTime?: number
  clockOffset?: number
}
export interface PublicState {
  preload?: import('./preload').PreloadAsset[]
  settings: Settings
  teams: Team[]
  question: Question | null
  session: Session
  draw: Draw | null
  lottery?: LotteryView | null
  page: number
  total: number
  revision: number
  serverTime: number
  clockOffset?: number
}
export interface Action {
  op: string
  id?: string
  teamId?: string
  correct?: boolean
  delta?: number
  playerDelta?: number
  player?: string
  note?: string
  position?: number
  rate?: number
  index?: number
  seconds?: number
  seq?: number
  enabled?: boolean
  delay?: number
}
export const kinds: Record<Kind, string> = {
  warmup: '暖场',
  intro: '开场 / 规则',
  choice: '单选题',
  soup: '海龟汤',
  song: '听歌识曲',
  draw: '你画我猜',
  score: '比分 / 颁奖',
}
export const mediaName = (m: Media, index: number) =>
  m.name?.trim() ||
  `${m.kind === 'audio' ? '音频' : m.kind === 'video' ? '视频' : '图片'} ${index + 1}`
export const uid = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('')
export function teamScore(s: State, id: string) {
  return s.scores.reduce((n, v) => n + (v.teamId === id ? v.delta : 0), 0)
}
export function publicView(s: State): PublicState {
  const now = Date.now() - (s.clockOffset ?? 0)
  const q = s.config.questions.find((v) => v.id === s.session.currentId)
  const enabled = s.config.questions.filter((v) => v.enabled)
  return {
    settings: s.config.settings,
    teams: s.config.teams.map((t) => ({ ...t, score: teamScore(s, t.id) })),
    question: q
      ? {
          ...q,
          answer: s.session.revealed ? q.answer : '',
          explanation: s.session.revealed ? q.explanation : '',
          media: (q.media || []).filter((m) => !m.answerOnly || s.session.revealed),
        }
      : null,
    session: s.session,
    draw:
      s.session.lotteryVisible &&
      !s.session.lotteryIntro &&
      (!s.draws.at(-1)?.revealAt || s.draws.at(-1)!.revealAt! <= now)
        ? s.draws.at(-1) || null
        : null,
    lottery: lotteryView(s, now),
    page: enabled.findIndex((v) => v.id === s.session.currentId) + 1,
    total: enabled.length,
    revision: s.revision,
    serverTime: now,
    clockOffset: s.clockOffset ?? 0,
  }
}

export function lotteryView(s: State, now: number): LotteryView | null {
  if (!s.session.lotteryVisible) return null
  const c = s.config.lottery,
    last = s.draws.at(-1)
  const rolling = !!last?.revealAt && last.revealAt > now
  const intro = s.session.lotteryIntro || !last
  const used = c.noRepeat
    ? [
        ...new Set(
          s.draws
            .filter((d) => d.mode === c.mode && (intro || d.id !== last?.id))
            .flatMap((d) => d.values),
        ),
      ]
    : []
  return {
    phase: intro ? 'intro' : rolling ? 'rolling' : 'result',
    mode: c.mode,
    count: intro ? c.count : last!.values.length,
    min: c.min,
    max: c.max,
    candidates: c.names.filter((n) => !used.includes(n)),
    used,
    drawId: intro ? '' : last!.id,
    startedAt: intro ? 0 : last!.at,
    revealAt: intro ? 0 : last!.revealAt || 0,
    // Needed before reveal to land on the real result without replacing a row.
    // The official public draw is still gated by its reveal deadline above.
    ...(intro ? {} : { landingValues: [...last!.values] }),
  }
}

export function questionPreviewView(
  state: State,
  draft: Question,
  preview: Pick<Session, 'revealed' | 'media'>,
): PublicState {
  const questions = [...state.config.questions]
  const index = questions.findIndex((q) => q.id === draft.id)
  const question = { ...draft, enabled: true }
  if (index < 0) questions.push(question)
  else questions[index] = question
  return publicView({
    ...state,
    clockOffset: 0,
    config: { ...state.config, questions },
    session: {
      currentId: draft.id,
      revealed: preview.revealed,
      media: { ...preview.media },
      timer: { remaining: draft.kind === 'warmup' ? 0 : draft.duration, deadline: 0 },
      lotteryVisible: false,
      videoFullscreen: false,
    },
  })
}
