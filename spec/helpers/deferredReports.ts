import { deferredReports } from '../../src/internals/Assertions'

/**
 * Runs the library's deferred reports (D9, D33) on demand instead of on a microtask.
 *
 * Since D34 the library captures the real scheduler when it is loaded (since E6 queueMicrotask, process.nextTick
 * where there is none), so fake timers installed by a test no longer intercept the reports. Every report goes
 * through `deferredReports.schedule`, which this stand-in replaces. It has the same shape as the fake clock the tests
 * used before: `tick()` runs the reports scheduled so far and rethrows the first one that throws. Like a microtask
 * checkpoint, it also runs what those schedule in turn (E58: the reports of check views that nothing followed are
 * checked in batches, one report per microtask), until nothing is left.
 */
export const interceptDeferredReports = () => {
  const original = deferredReports.schedule
  let queue: Array<() => void> = []
  deferredReports.schedule = callback => { queue.push(callback) }
  return {
    tick(_milliseconds?: number): void {
      const errors = this.run()
      if (errors.length > 0) throw errors[0]
    },
    /** Runs what is scheduled, as tick() does, and returns everything thrown, in order. */
    run(): unknown[] {
      const errors: unknown[] = []
      while (queue.length > 0) {
        const scheduled = queue
        queue = []
        for (const callback of scheduled) {
          try {
            callback()
          } catch (error) {
            errors.push(error)
          }
        }
      }
      return errors
    },
    uninstall(): void {
      deferredReports.schedule = original
    }
  }
}
