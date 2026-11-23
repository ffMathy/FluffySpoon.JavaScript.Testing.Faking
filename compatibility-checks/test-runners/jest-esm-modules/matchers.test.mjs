import { describe, expect, jest, test } from '@jest/globals'
import { expect as expect29 } from 'expect-jest29'
import { Substitute, Arg } from '@fluffy-spoon/substitute'

// Round 15 (E96, R14FE-4): with native ES modules (the package's ES module entry, NODE_OPTIONS=--experimental-vm-modules),
// an Arg matcher inside the sample of one of jest's asymmetric matchers matches as the Arg matcher, in checks, setups
// and jest's own toEqual. Checked with the expect of jest 30 (this runner) and of jest 29 (expect-jest29).
// test/index.ts runs this file with jest.modules.esm.config.js; it must pass.

for (const [version, jestExpect] of [['jest 30', expect], ['jest 29', expect29]]) {
  describe(`E96 Arg matchers inside jest's asymmetric matchers (ES modules, ${version})`, () => {
    test('checks and setups', () => {
      const producer = Substitute.for()
      producer.send({ topic: 'orders', messages: [{ key: 'o1' }] })
      producer.received(1).send(jestExpect.objectContaining({ topic: Arg.any('string') }))
      producer.received(1).send({ topic: 'orders', messages: jestExpect.arrayContaining([{ key: Arg.any() }]) })
      expect(() => producer.didNotReceive().send(jestExpect.objectContaining({ topic: Arg.any('string') }))).toThrow(
        'Expected to receive 0 method calls matching send(ObjectContaining { topic: Arg.any{string} }), but received 1.'
      )
      const repo = Substitute.for()
      repo.save(jestExpect.objectContaining({ id: Arg.any() })).returns('saved')
      expect(repo.save({ id: 7, name: 'x' })).toBe('saved')
    })

    test('jest\'s own equality', () => {
      jestExpect({ id: 7 }).toEqual({ id: Arg.any() })
      jestExpect({ id: 7 }).not.toEqual({ id: Arg.any('string') })
      const fn = jest.fn()
      fn({ id: 1 })
      jestExpect(fn).toHaveBeenCalledWith({ id: Arg.is(id => id === 1) })
    })
  })
}
