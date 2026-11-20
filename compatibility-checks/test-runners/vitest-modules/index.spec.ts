import { describe, expect, test, vi } from 'vitest'
import api from './src/api'
import { loadHistory, shout } from './src/history'

// Round 9 (E53, R8-ADV-1, R8FE-1): vi.mock() needs a factory that returns an object (a substitute is a function, and
// vitest refuses it: "vi.mock(...) is not returning an object"). The documented pattern: return a plain object whose
// members are the substitute's member handles, with the substitute as the default export, to configure and check it.
// Unlike test-runners/vitest, this suite is expected to pass; test/index.ts runs it.

vi.mock('./src/api', async () => {
  const { Substitute } = await import('@fluffy-spoon/substitute')
  const api = Substitute.for<any>()
  return { default: api, fetchHistory: api.fetchHistory, post: api.post }
})

/** The substitute behind the module's members (the default export of the factory's object). */
const apiSub = api as any

describe('E53 vi.mock with a plain object of member handles', () => {
  test('named and namespace imports of the code under test reach the setups, and the calls are checked', async () => {
    apiSub.fetchHistory('lobby').resolves(['a', 'b'])
    apiSub.post('lobby', 'HEY').resolves()
    expect(await loadHistory('lobby')).toEqual(['A', 'B'])
    await shout('lobby', 'hey')
    apiSub.received(1).fetchHistory('lobby')
    apiSub.received(1).post('lobby', 'HEY')
    expect(() => apiSub.didNotReceive().post('lobby', 'HEY')).toThrow('Call count mismatch')
  })
})
