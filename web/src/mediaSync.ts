export interface MediaSyncSample {
  cue: string
  /** Monotonic milliseconds, separate from the calibrated playback clock. */
  now: number
  position: number
  currentTime: number
  rate: number
  play: boolean
  ended: boolean
  enabled: boolean
  readyState: number
  seeking: boolean
  waiting: boolean
  paused: boolean
}

/** Keeps explicit commands prompt without making native decoding chase every clock tick. */
export class MediaSyncController {
  private appliedCue: string | null = null
  private healthySince: number | null = null
  private driftSince: number | null = null
  private settledAt = -Infinity
  private wasSeeking = false
  private nextAutomaticAt = -Infinity
  private automaticInterval = 5000

  seekCompleted(now: number) {
    this.settledAt = now
    this.wasSeeking = false
    this.healthySince = null
    this.driftSince = null
  }

  synchronize(sample: MediaSyncSample, seek: (position: number) => void): 'cue' | 'drift' | null {
    const { now } = sample
    // Reaching the shared endpoint is a one-shot terminal cue, including when
    // the remaining native lag is too small to justify normal drift recovery.
    const cue = JSON.stringify([sample.cue, sample.ended])
    if (this.wasSeeking && !sample.seeking) this.seekCompleted(now)
    this.wasSeeking = sample.seeking
    const healthy =
      sample.enabled &&
      sample.play &&
      !sample.ended &&
      !sample.paused &&
      !sample.seeking &&
      !sample.waiting &&
      sample.readyState >= 3
    if (healthy) this.healthySince ??= now
    else {
      this.healthySince = null
      this.driftSince = null
    }

    if (this.appliedCue !== cue) {
      // Do not consume a command before metadata exists, or replace an in-flight
      // native seek. The next event/tick supplies the newest command and target.
      if (sample.readyState < 1 || sample.seeking) return null
      const needsSeek = Math.abs(sample.position - sample.currentTime) > 0.03
      if (needsSeek && !this.performSeek(sample, seek)) return null
      this.appliedCue = cue
      this.nextAutomaticAt = now + 5000
      this.automaticInterval = 5000
      this.healthySince = null
      this.driftSince = null
      return needsSeek ? 'cue' : null
    }

    if (!healthy) return null
    // Compare wall-clock drift so that 2× does not halve the decoding tolerance.
    if (Math.abs(sample.position - sample.currentTime) / sample.rate <= 0.75) {
      this.driftSince = null
      return null
    }
    this.driftSince ??= now
    if (
      this.healthySince === null ||
      now - this.healthySince < 2000 ||
      now - this.settledAt < 2000 ||
      now - this.driftSince < 1000 ||
      now < this.nextAutomaticAt
    )
      return null

    // A problematic file still gets native decoding windows after each seek.
    // Repeated automatic recovery backs off to 5, 10, then 20 seconds; a new
    // explicit cue bypasses and resets this schedule.
    this.nextAutomaticAt = now + this.automaticInterval
    this.automaticInterval = Math.min(20000, this.automaticInterval * 2)
    return this.performSeek(sample, seek) ? 'drift' : null
  }

  private performSeek(sample: MediaSyncSample, seek: (position: number) => void) {
    try {
      seek(sample.position)
    } catch {
      return false
    }
    this.settledAt = sample.now
    this.healthySince = null
    this.driftSince = null
    return true
  }
}
