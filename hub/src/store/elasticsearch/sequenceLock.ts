export class SequenceLock {
    private readonly locks = new Map<string, Promise<unknown>>()

    async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const previous = this.locks.get(key) ?? Promise.resolve()
        const run = previous.catch(() => undefined).then(fn)
        const releaseCurrent = run.catch(() => undefined)
        this.locks.set(key, releaseCurrent)
        try {
            return await run
        } finally {
            if (this.locks.get(key) === releaseCurrent) {
                this.locks.delete(key)
            }
        }
    }
}
