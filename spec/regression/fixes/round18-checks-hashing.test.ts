import test from 'ava'

import { Substitute, Arg, received } from '../../../src'
import { assertRatiosWithin, millisecondsOf, timeLimit, assertWithin } from '../../helpers/timing'

// Round 18, engine (checks through a call with matchers): the timing test of E121 (R17V-2). The file name puts it into
// the serial run of the timing-sensitive files (see ava.config.js: '*hashing*'); the other round-18 checks tests are in
// round18-checks.test.ts.

/** The middle value of `values`. */
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1]

/** The shapes of R17V-2: N calls of the code under test, each answered with an auto-substitute of its own, then one check. */
const shapes = {
  // verify17/regv17-w/mine/r17v2.js: repo.find(i).close() N times, then repo.find(Arg.any()).received(N).close()
  received: (count: number): (() => void) => {
    const repo = Substitute.for<any>()
    for (let index = 0; index < count; index++) repo.find(index).close()
    return () => repo.find(Arg.any()).received(count).close()
  },
  symbol: (count: number): (() => void) => {
    const repo = Substitute.for<any>()
    for (let index = 0; index < count; index++) repo.find(index).close()
    return () => repo.find(Arg.any())[received](count).close()
  },
  // r17v2m.js: a member step below the call with matchers
  member: (count: number): (() => void) => {
    const api = Substitute.for<any>()
    for (let index = 0; index < count; index++) api.client(`c${index}`).items.clear()
    return () => api.client(Arg.any()).items.received(count).clear()
  },
  // r17v2f.js: a failing check, whose message lists the calls (each with the substitute it was made on)
  failing: (count: number): (() => void) => {
    const repo = Substitute.for<any>()
    for (let index = 0; index < count; index++) repo.find(index).close()
    return () => {
      try {
        repo.find(Arg.any()).received(count + 1).close()
      } catch {
        return
      }
      throw new Error('the check passed')
    }
  }
}
type Shape = keyof typeof shapes

/** The time of one check per received call, in microseconds (the calls are made beforehand, outside the timing). */
const perCall = (shape: Shape, count: number): number => {
  const check = shapes[shape](count)
  return millisecondsOf(check) * 1000 / count
}

test('R17V-2 (E121) a check through a call with matchers costs the same per matching call at 20,000 calls as at 2,000', t => {
  // 5c41ddc found the group of each substitute by a linear search over the groups listed so far: one check of 20,000
  // calls took 1.5 to 2.8 s (75 to 140 microseconds per call, 15 to 30 times its cost per call at 2,000 calls); 8be3a70,
  // cd1bf29 and round 18 take 30 to 90 ms (2 to 5 microseconds per call, 0.6 to 2 times its cost at 2,000 calls: sorting
  // and collecting more records, and the garbage collector, cost a little more per call)
  const kinds = Object.keys(shapes) as Shape[]
  for (const shape of kinds) perCall(shape, 200) // (warm-up)
  assertRatiosWithin(t, () => {
    const small: Record<string, number[]> = {}
    const large: Record<string, number[]> = {}
    for (let run = 0; run < 3; run++) {
      for (const shape of kinds) {
        (small[shape] ?? (small[shape] = [])).push(perCall(shape, 2000));
        (large[shape] ?? (large[shape] = [])).push(perCall(shape, 20000))
      }
    }
    const ratios = {} as Record<Shape, number>
    for (const shape of kinds) ratios[shape] = median(large[shape]) / median(small[shape])
    return ratios
  }, 4, 'time per received call of one check at 20,000 calls against 2,000')
})

test('R17V-2 (E121) one check through a call with matchers of 20,000 calls, each answered with its own substitute, takes well under a second', t => {
  // (5c41ddc: 1.5 to 2.8 s; round 18: about 60 ms for the plain check, 90 ms with a member step, on an idle machine)
  for (const shape of Object.keys(shapes) as Shape[]) {
    const check = shapes[shape](20000)
    const limit = timeLimit(600)
    assertWithin(t, millisecondsOf(check), limit, `one ${shape} check of 20,000 calls`)
  }
})

test('R17V-2 (E121) checks and setups through a call with matchers leave nothing behind, so the 10,000th costs what the first does', t => {
  // each check read the member (repo.find) before calling it with matchers, and the read, retracted, stayed among the
  // member's records: 5c41ddc, 8be3a70 and cd1bf29 looked at all of them in every later check (a check of a member with
  // 10 calls after 11,000 checks and setups took about 10 times as long as the first)
  const batch = (repo: any, checks: number) => millisecondsOf(() => {
    for (let index = 0; index < checks; index++) repo.find(Arg.any()).received(10).close()
  })
  assertRatiosWithin(t, () => {
    const firsts: number[] = []
    const lasts: number[] = []
    for (let run = 0; run < 3; run++) {
      const repo = Substitute.for<any>()
      for (let index = 0; index < 10; index++) repo.find(index).close()
      batch(repo, 200) // (warm-up)
      firsts.push(batch(repo, 1000))
      batch(repo, 10000)
      for (let index = 0; index < 1000; index++) repo.find(Arg.any()).returns(undefined) // setups, too
      lasts.push(batch(repo, 1000))
    }
    return { later: median(lasts) / median(firsts) }
  }, 2, 'a thousand checks after 11,000 checks and setups against the first thousand')
})
