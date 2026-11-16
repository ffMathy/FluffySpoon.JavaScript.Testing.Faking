import { deferredReports } from '../../src/internals/Assertions'

/**
 * Runs the library's deferred reports (D9, D33) on demand instead of on process.nextTick.
 *
 * Since D34 the library captures the real process.nextTick when it is loaded, so fake timers installed by a test
 * no longer intercept the reports. The tests use this stand-in, which has the same shape as the fake clock they
 * used before: `tick()` runs the reports scheduled so far and rethrows the first one that throws.
 */
export const interceptDeferredReports = () => {
  const original = deferredReports.schedule
  let queue: Array<() => void> = []
  deferredReports.schedule = callback => { queue.push(callback) }
  return {
    tick(_milliseconds?: number): void {
      const scheduled = queue
      queue = []
      let failure: { error: unknown } | undefined
      for (const callback of scheduled) {
        try {
          callback()
        } catch (error) {
          if (failure === undefined) failure = { error }
        }
      }
      if (failure !== undefined) throw failure.error
    },
    uninstall(): void {
      deferredReports.schedule = original
    }
  }
}
