import { useEffect, useState } from 'react'
import { startClockUntil } from './playback'

export function useNow(until: number): number {
  const [sample, setSample] = useState(() => ({ until: 0, now: Date.now() }))
  useEffect(() => {
    if (until <= Date.now()) return
    setSample({ until, now: Date.now() })
    return startClockUntil(until, (now) => setSample({ until, now }))
  }, [until])
  // A changed deadline uses current time immediately, before the effect runs.
  return sample.until === until ? sample.now : Date.now()
}
