import type { Illustration } from './types'

const snapshot = (items: Illustration[]) => items.map((item) => ({ ...item }))
export const sameIllustrations = (left: Illustration[], right: Illustration[]) =>
  JSON.stringify(left) === JSON.stringify(right)

export class IllustrationHistory {
  key: string
  items: Illustration[]
  private past: Illustration[][] = []
  private future: Illustration[][] = []
  private gesture: Illustration[] | null = null

  constructor(key: string, items: Illustration[]) {
    this.key = key
    this.items = snapshot(items)
  }

  get canUndo() {
    return this.past.length > 0 || (!!this.gesture && !sameIllustrations(this.gesture, this.items))
  }

  get canRedo() {
    return this.future.length > 0
  }

  reset(key: string, items: Illustration[]) {
    this.key = key
    this.items = snapshot(items)
    this.past = []
    this.future = []
    this.gesture = null
  }

  beginGesture() {
    if (!this.gesture) this.gesture = snapshot(this.items)
  }

  endGesture() {
    if (this.gesture && !sameIllustrations(this.gesture, this.items)) this.remember(this.gesture)
    this.gesture = null
  }

  change(items: Illustration[]) {
    if (sameIllustrations(items, this.items)) return false
    if (!this.gesture) this.remember(this.items)
    this.items = snapshot(items)
    this.future = []
    return true
  }

  undo() {
    this.endGesture()
    const previous = this.past.pop()
    if (previous) {
      this.future.push(snapshot(this.items))
      this.items = previous
    }
    return snapshot(this.items)
  }

  redo() {
    this.endGesture()
    const next = this.future.pop()
    if (next) {
      this.remember(this.items)
      this.items = next
    }
    return snapshot(this.items)
  }

  private remember(items: Illustration[]) {
    this.past.push(snapshot(items))
    if (this.past.length > 60) this.past.shift()
  }
}
