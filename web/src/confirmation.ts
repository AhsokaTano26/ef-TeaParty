export interface ConfirmationOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export function createConfirmationController(
  onChange: (options: ConfirmationOptions | null) => void,
) {
  let resolve: ((accepted: boolean) => void) | null = null
  return {
    request(options: ConfirmationOptions): Promise<boolean> {
      if (resolve) return Promise.resolve(false)
      return new Promise((done) => {
        resolve = done
        onChange(options)
      })
    },
    settle(accepted: boolean) {
      const done = resolve
      resolve = null
      if (done) {
        onChange(null)
        done(accepted)
      }
    },
  }
}
