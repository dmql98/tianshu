export class CancelScope {
  private _aborted = false
  private _abortController = new AbortController()
  private _children: CancelScope[] = []
  private _finalizers: (() => void)[] = []

  get signal(): AbortSignal { return this._abortController.signal }
  get aborted(): boolean { return this._aborted }

  fork<T>(fn: (scope: CancelScope) => Promise<T>): Promise<T> {
    if (this._aborted) return Promise.reject(new Error('Scope already cancelled'))
    const child = new CancelScope()
    this._children.push(child)
    const promise = fn(child)
    promise.then(
      () => this._removeChild(child),
      () => this._removeChild(child),
    )
    return promise
  }

  defer(fn: () => void) {
    if (this._aborted) { fn(); return }
    this._finalizers.push(fn)
  }

  cancel() {
    if (this._aborted) return
    this._aborted = true
    this._abortController.abort()
    for (const child of [...this._children]) child.cancel()
    for (const fn of this._finalizers) fn()
    this._children = []
    this._finalizers = []
  }

  private _removeChild(child: CancelScope) {
    const idx = this._children.indexOf(child)
    if (idx >= 0) this._children.splice(idx, 1)
  }
}
