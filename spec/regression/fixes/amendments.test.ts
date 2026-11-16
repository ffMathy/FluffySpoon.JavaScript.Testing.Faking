import test from 'ava'
import { types } from 'util'

import { Substitute, Arg, configure, mimick, received, returns, throws, resolves, rejects, mimicks } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'

// Round 2 amendments of the fix spec (D22-D24, the amended D9 message) and the message hints.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')
const listedLines = (message: string) => plain(message).split('\n').filter(line => line.startsWith('› '))

const substitutionSymbols = { returns, throws, resolves, rejects, mimicks }

test('D22 a substitution symbol read on a root substitute is a usage error', t => {
  for (const [name, symbol] of Object.entries(substitutionSymbols)) {
    const substitute = Substitute.for<any>()
    const error = t.throws<SubstituteException>(() => substitute[symbol], { instanceOf: SubstituteException }, name)
    t.true(error.message.startsWith(`[${name}] cannot be used on a substitute itself`), name)
    t.true(error.message.includes(`sub.member[${name}](value)`), name)
    t.is(error.type, undefined, `${name}: a usage error, not a call count mismatch`)

    // the read was not recorded and nothing was configured
    t.notThrows(() => substitute.received(0)[name], name)
    t.true(types.isProxy(substitute.add(1)), name)

    // the configure view of the substitute rejects them as well
    t.throws(() => substitute[configure]()[symbol], { instanceOf: SubstituteException }, `${name}: configure view`)
    // a mimicking substitute too
    const mimicking = Substitute.for<any>()
    mimicking[mimick]({ value: 1 })
    t.throws(() => mimicking[symbol], { instanceOf: SubstituteException }, `${name}: mimicking`)
  }

  // the error starts at the user's line, not in the library
  const error = t.throws(() => (Substitute.for<any>() as any)[returns](1), { instanceOf: SubstituteException })
  t.regex(error.stack!.split('\n')[1], /amendments\.test/)
})

test('D22 substitution symbols on members and calls, and the string names on the root, keep working', t => {
  const substitute = Substitute.for<any>()
  substitute.value[returns](1)
  substitute.add(1, 2)[returns](3)
  substitute.find(Arg.any())[throws](new Error('nope'))
  substitute.logger.level[returns](4)
  substitute.getCalc()[returns]('calc')
  t.is(substitute.value, 1)
  t.is(substitute.add(1, 2), 3)
  t.throws(() => substitute.find(1), { message: 'nope' })
  t.is(substitute.logger.level, 4)
  t.is(substitute.getCalc(), 'calc')

  // the string names are ordinary members on the root (D11)
  const shop = Substitute.for<any>()
  shop.returns(5)
  t.notThrows(() => shop.received(1).returns(5))
  t.notThrows(() => shop[received](1).returns(5))

  // a substitute returned by a configured call is a root: [returns] on it points to configure()
  const factory = Substitute.for<any>()
  const repository = Substitute.for<any>()
  factory.create('a').returns(repository)
  const error = t.throws(() => factory.create('a')[returns](Substitute.for<any>()), { instanceOf: SubstituteException })
  t.true(error.message.includes('sub[configure]()'))
  factory[configure]().create('a').returns('reconfigured')
  t.is(factory.create('a'), 'reconfigured')
})

test('D23 a message lists at most 50 received calls, then "… and N more"', t => {
  const logger = Substitute.for<any>()
  for (let index = 0; index < 60; index++) logger.log(index)
  const error = t.throws(() => logger.received(1).log('x'), { instanceOf: SubstituteException })
  const message = plain(error.message)
  t.true(message.includes('\n› … and 10 more\n'))
  const lines = listedLines(message)
  t.is(lines.length, 51)
  t.is(lines[0], '› ✘ @Substitute.log(0)')
  t.is(lines[49], '› ✘ @Substitute.log(49)')
  t.is(lines[50], '› … and 10 more')
  t.false(message.includes('@Substitute.log(50)'))
  t.true(message.endsWith('› … and 10 more\n'))

  // the count in the expectation line still covers every call
  const tooMany = t.throws(() => logger.received(61).log(Arg.any()), { instanceOf: SubstituteException })
  t.regex(plain(tooMany.message), /Expected to receive 61 method calls matching log\(Arg\.any\{any\}\), but received 60\./)
  t.true(plain(tooMany.message).includes('› ✔ @Substitute.log(49)\n'))
  t.true(plain(tooMany.message).includes('› … and 10 more'))

  // exactly 50 calls: no "more" line
  const fifty = Substitute.for<any>()
  for (let index = 0; index < 50; index++) fifty.log(index)
  const complete = plain(t.throws(() => fifty.received(1).log('x'), { instanceOf: SubstituteException }).message)
  t.is(listedLines(complete).length, 50)
  t.false(complete.includes('more'))

  // property reads and assignments are capped the same way
  const settings = Substitute.for<any>()
  for (let index = 0; index < 55; index++) {
    void settings.value
    settings.value = index
  }
  const reads = plain(t.throws(() => settings.received(56).value, { instanceOf: SubstituteException }).message)
  t.true(reads.includes('› … and 5 more'))
  const sets = plain(t.throws(() => { settings.received(1).value = -1 }, { instanceOf: SubstituteException }).message)
  t.is(listedLines(sets).length, 51)
  t.true(sets.includes('› ✘ @Substitute.value = 49\n'))
  t.true(sets.includes('› … and 5 more'))
})
