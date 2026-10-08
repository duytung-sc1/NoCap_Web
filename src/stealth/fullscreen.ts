interface FullscreenTarget {
  requestFullscreen?: () => Promise<void>
}

interface FullscreenDocument {
  readonly fullscreenElement: FullscreenTarget | null
  exitFullscreen: () => Promise<void>
}

/** Owns only the disguise's fullscreen request, including a pending entry. */
export class DisguiseFullscreen {
  private disposed = false
  private pending = false
  private target: FullscreenTarget
  private document: FullscreenDocument

  constructor(target: FullscreenTarget, document: FullscreenDocument) {
    this.target = target
    this.document = document
  }

  get active() { return this.document.fullscreenElement === this.target }

  async toggle(): Promise<boolean> {
    if (this.disposed) return false
    if (this.pending) return true
    if (this.active) { await this.exit(); return true }
    if (!this.target.requestFullscreen || this.document.fullscreenElement) return false
    this.pending = true
    try {
      await this.target.requestFullscreen()
      if (this.disposed) await this.exit()
      return !this.disposed
    } finally { this.pending = false }
  }

  async exit() {
    if (this.active) await this.document.exitFullscreen()
  }

  dispose() {
    this.disposed = true
    void this.exit().catch(() => { /* The browser may already have exited. */ })
  }
}
