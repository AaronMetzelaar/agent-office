export type Guard = ReturnType<typeof createGuard>

export function createGuard(log: (message: string) => void = (message) => console.error(message)) {
  const off = new Set<string>()
  return {
    run<T>(name: string, fallback: T, work: () => T): T {
      if (off.has(name)) return fallback
      try {
        return work()
      } catch (error) {
        off.add(name)
        log(`[office] ${name} stopped after an error and is now off: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
        return fallback
      }
    },
    off: (name: string) => off.has(name),
  }
}
