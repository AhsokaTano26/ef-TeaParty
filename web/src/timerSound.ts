import timerEnd from './assets/timer-end.wav'

let sound: HTMLAudioElement | undefined
let generation = 0
const audio = () => (sound ||= new Audio(timerEnd))

export async function unlockTimerSound() {
  const el = audio(),
    current = ++generation
  el.muted = true
  try {
    await el.play()
  } catch {
    /* A later trusted click can retry. */
  } finally {
    if (current === generation) {
      el.pause()
      el.currentTime = 0
      el.muted = false
    }
  }
}

export function stopTimerSound() {
  generation++
  sound?.pause()
}

export async function playTimerSound() {
  const el = audio()
  generation++
  el.muted = false
  el.currentTime = 0
  try {
    await el.play()
    return true
  } catch {
    return false
  }
}
