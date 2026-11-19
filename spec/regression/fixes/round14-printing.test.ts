import test from 'ava'
import { inspect } from 'util'

import { Substitute, Arg } from '../../../src'
import { SubstituteException } from '../../../src/internals/SubstituteException'
import {
  DIFFERENCE_ENTRIES, DifferenceSearch, MAX_MESSAGE_DEPTH, MESSAGE_BOUNDS, firstVisibleDifference, formatValue, messageBounds
} from '../../../src/internals/utilities/Stringify'

// Round 14: how printouts and failure messages print values (fix spec E84, E86, E87), the findings of round 13
// R13-ADV-1, R13FE-1 and R13FE-2.

const plain = (text: string) => text.replace(/\x1b\[\d+m/g, '')

/** The message of a failing check, without colours and without its "called at" lines. */
const messageOf = (assertion: () => unknown): string => {
  try {
    assertion()
  } catch (error) {
    if (!(error instanceof SubstituteException)) throw error
    return plain(error.message).split('\n').filter(line => !/^\s+called at /.test(line)).join('\n')
  }
  throw new Error('expected the assertion to fail')
}

// ---- E84 (R13-ADV-1): the comparison in any order only where it decides ---------------------------------------------

/** A difference search as a failure message makes one, counting the values it prints. */
const differenceSearch = (entries = DIFFERENCE_ENTRIES) => {
  const counts = { printed: 0 }
  const search: DifferenceSearch = {
    bounds: MESSAGE_BOUNDS,
    maxDepth: MAX_MESSAGE_DEPTH,
    textOf: (value, depth) => {
      counts.printed++
      return formatValue(value, false, messageBounds(depth))
    },
    keys: new Map(),
    entries
  }
  return { search, counts }
}

const row = (id: number) => ({ id, name: `n${id}`, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: { h: id } })
const rows = (reversed: boolean) => {
  const all = Array.from({ length: 20 }, (_, index) => row(index))
  return reversed ? all.reverse() : all
}
/** Own properties for an error or a function (an error shows its first 10). */
const properties = (reversed: boolean) => {
  const all = rows(false).slice(0, 8).map(each => [`r${each.id}`, each.g] as const)
  return Object.fromEntries(reversed ? all.reverse() : all)
}
const shapes = {
  Set: (reversed: boolean) => new Set(rows(reversed)),
  Map: (reversed: boolean) => new Map(rows(reversed).map(each => [{ id: each.id }, each])),
  error: (reversed: boolean) => Object.assign(new Error('failed'), properties(reversed)),
  function: (reversed: boolean) => Object.assign(function handler() { }, properties(reversed))
}

test('R13-ADV-1 (E84) a Set, a Map, an error or a function in another order is not compared in any order when another argument already differs', t => {
  for (const [kind, shape] of Object.entries(shapes)) {
    // the received call holds the value in another order, and another argument differs at depth 0
    for (const [expected, actual] of [[[shape(false), 'batch-x'], [shape(true), 'batch-1']], [['batch-x', shape(false)], ['batch-1', shape(true)]]]) {
      const { search, counts } = differenceSearch()
      t.is(firstVisibleDifference(search, expected, actual, 2), 0, kind)
      t.true(search.complete, kind)
      // 53a98bc printed the sorted texts of the entries (or properties) at every depth, on both sides; a Map or a Set
      // in its order is compared without printing (an error or a function by its text, as before round 13)
      t.is(search.sortedTexts, undefined, kind)
      if (kind === 'Set' || kind === 'Map') t.is(counts.printed, 0, kind)
    }
    // also when the other argument differs only further down (the city shows from depth 2 on), at a depth that
    // decides what the message wants to know (whether the lines print differently at 4 levels or less)
    const deep = (city: string) => ({ user: { address: { city } } })
    const { search } = differenceSearch()
    t.is(firstVisibleDifference(search, [shape(false), deep('Oslo')], [shape(true), deep('Bergen')], 4), 2, kind)
    t.is(search.sortedTexts, undefined, kind)
  }
})

test('R13-ADV-1 (E84) a value in another order is still compared in any order where that decides how deep the lines print', t => {
  // the city shows from depth 3 on
  const deep = (city: string) => ({ order: { user: { address: { city } } } })
  for (const [kind, shape] of Object.entries(shapes)) {
    // only the order differs: the lines print alike up to four levels deep (E78)
    const alike = differenceSearch()
    t.is(firstVisibleDifference(alike.search, [shape(false), 'x'], [shape(true), 'x'], 2), Infinity, kind)
    t.true(alike.search.complete, kind)
    // and a difference three levels down in another argument decides (it shows from depth 3 on)
    const deeper = differenceSearch()
    t.is(firstVisibleDifference(deeper.search, [shape(false), deep('Oslo')], [shape(true), deep('Bergen')], 2), 3, kind)
    // the same with the arguments the other way round
    const reversed = differenceSearch()
    t.is(firstVisibleDifference(reversed.search, [deep('Oslo'), shape(false)], [deep('Bergen'), shape(true)], 2), 3, kind)
  }
  // a real difference inside the reordered value still shows (a name, from depth 1 on: at the depth the lines are
  // printed at, 2, which tells as much)
  const changed = shapes.Set(true)
  const first = [...changed][0] as { name: string }
  first.name = 'changed'
  t.is(firstVisibleDifference(differenceSearch().search, [shapes.Set(false), deep('Oslo')], [changed, deep('Oslo')], 2), 2)
  t.is(firstVisibleDifference(differenceSearch().search, [shapes.Set(false), deep('Oslo')], [changed, deep('Oslo')], -1), 1)
  // and an error whose properties beyond the first 10 come in another order prints differently (what shows differs)
  const wide = (reversed: boolean) => {
    const all = rows(false).map(each => [`r${each.id}`, each.id] as const)
    return Object.assign(new Error('failed'), Object.fromEntries(reversed ? all.reverse() : all))
  }
  t.is(firstVisibleDifference(differenceSearch().search, [wide(false), deep('Oslo')], [wide(true), deep('Bergen')], -1), 0)
})

test('R13-ADV-1 (E84) the sorted texts of the comparison in any order count towards the search budget', t => {
  for (const [kind, shape] of Object.entries(shapes)) {
    const { search } = differenceSearch(100_000)
    t.is(firstVisibleDifference(search, [shape(false)], [shape(true)], 2), Infinity, kind)
    t.not(search.sortedTexts, undefined, kind)
    // the texts show 20 rows of 9 keys and a nested object (or 8 properties holding an object) at the depths
    // tried, on both sides; 53a98bc charged only the entries that the comparison looked at (41, 25, 1 and 1)
    t.true(100_000 - search.entries > (kind === 'Set' || kind === 'Map' ? 1000 : 40), `${kind}: ${100_000 - search.entries}`)
  }
  // a comparison in any order that the budget cuts short does not count (E78): the one in their order does, and the
  // lines of the message after it are printed as deep as the ones before (E70)
  const { search } = differenceSearch(300)
  t.is(firstVisibleDifference(search, [shapes.Set(false)], [shapes.Set(true)], 2), 1)
  t.true(search.entries < 0)
})

test('R13-ADV-1 (E84) a failing check whose calls hold a Set or a Map in another order prints the same message as before', t => {
  const audit = Substitute.for<any>()
  for (let index = 0; index < 3; index++) audit.record(shapes.Set(true), `batch-${index}`)
  const message = messageOf(() => audit.received(1).record(shapes.Set(false), 'batch-x'))
  // each line in its own order, two levels deep
  t.true(message.includes("record(Set(20) {\n  {\n    id: 0,\n    name: 'n0',"), message)
  t.true(message.includes("› ✘ @Substitute.record(Set(20) {\n  {\n    id: 19,\n    name: 'n19',"), message)
  t.true(message.includes("g: { h: 0 }"), message)
  t.false(message.includes('Some calls print the same'), message)
})

// ---- E86 (R13FE-1): matchers of test runners nested in the samples of others ----------------------------------------

/*
 * The shapes of jest's and vitest's asymmetric matchers (expect 30: own `$$typeof`, `sample`, `inverse`; @vitest/expect 5:
 * own `sample`, `inverse`, `$$typeof`; both with asymmetricMatch and toString, and some with toAsymmetricMatcher, on the
 * prototype). The compatibility checks use the real ones.
 */
const runnerMatchers = (order: 'jest' | 'vitest') => {
  class AsymmetricMatcher<T> {
    $$typeof!: symbol
    sample!: T
    inverse!: boolean
    constructor(sample: T, inverse = false) {
      if (order === 'jest') this.$$typeof = Symbol.for('jest.asymmetricMatcher')
      this.sample = sample
      this.inverse = inverse
      if (order === 'vitest') this.$$typeof = Symbol.for('jest.asymmetricMatcher')
    }
  }
  class Any extends AsymmetricMatcher<Function> {
    asymmetricMatch(other: unknown): boolean { return this.sample === Number ? typeof other === 'number' : other instanceof this.sample }
    toString(): string { return 'Any' }
    toAsymmetricMatcher(): string { return `Any<${this.sample.name}>` }
  }
  class ObjectContaining extends AsymmetricMatcher<Record<string, unknown>> {
    asymmetricMatch(other: any): boolean {
      return typeof other === 'object' && other !== null && Object.keys(this.sample).every(key => {
        const expected: any = this.sample[key]
        return expected instanceof AsymmetricMatcher ? (expected as any).asymmetricMatch(other[key]) : other[key] === expected
      })
    }
    toString(): string { return `Object${this.inverse ? 'Not' : ''}Containing` }
  }
  class ArrayContaining extends AsymmetricMatcher<unknown[]> {
    asymmetricMatch(other: unknown): boolean {
      return Array.isArray(other) && this.sample.every((expected: any) => other.some(item =>
        expected instanceof AsymmetricMatcher ? (expected as any).asymmetricMatch(item) : item === expected))
    }
    toString(): string { return `Array${this.inverse ? 'Not' : ''}Containing` }
  }
  return {
    any: (sample: Function) => new Any(sample),
    objectContaining: (sample: Record<string, unknown>) => new ObjectContaining(sample),
    arrayContaining: (sample: unknown[]) => new ArrayContaining(sample)
  }
}

for (const runner of ['jest', 'vitest'] as const) {
  test(`R13FE-1 (E86) ${runner}'s matchers nested three levels deep in the samples of others print with their own text`, t => {
    const expect = runnerMatchers(runner)
    // an AWS SDK v3 style check
    const client = Substitute.for<any>()
    client.send({ input: { TransactItems: [1, 2] } })
    const message = messageOf(() => client.received(1).send(expect.objectContaining({ input: expect.objectContaining({ TransactItems: expect.arrayContaining([3]) }) })))
    t.true(message.includes('send(ObjectContaining { input: ObjectContaining { TransactItems: ArrayContaining [ 3 ] } })'), message)
    // three levels deep, in a failure message, a printout of the substitute and a path label
    const three = (name: string) => expect.objectContaining({ a: expect.objectContaining({ b: expect.objectContaining({ c: expect.any(Number) }) }), name })
    const threeText = (name: string) => `ObjectContaining { a: ObjectContaining { b: ObjectContaining { c: Any<Number> } }, name: '${name}' }`
    const deep = messageOf(() => client.received(1).send(three('x')))
    t.true(deep.replace(/\n\s*/g, ' ').includes(`send(${threeText('x')})`), deep)
    const repo = Substitute.for<any>()
    repo.find(three('setup')).returns(5)
    const printout = plain(String(repo))
    t.true(printout.replace(/\n\s*/g, ' ').includes(`find(${threeText('setup')}) => returns(5)`), printout)
    const path = plain(inspect(repo.find(three('path'))))
    t.true(path.includes(`@Substitute.find(${threeText('path')})`), path)
    // a matcher in an array in a sample, and in a plain object in a sample deeper than the message prints
    const inArray = messageOf(() => client.received(1).send({ input: { items: expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]) } }))
    t.true(inArray.includes('items: ArrayContaining [ ObjectContaining { id: Any<String> } ]'), inArray)
    const inObject = messageOf(() => client.received(1).send(expect.objectContaining({ input: { deep: { deeper: { items: expect.arrayContaining([expect.any(String)]) } } } })))
    t.true(inObject.replace(/\n\s*/g, ' ').includes('ObjectContaining { input: { deep: { deeper: { items: ArrayContaining [ Any<String> ] } } } }'), inObject)
    for (const text of [message, deep, printout, path, inArray, inObject]) {
      t.false(text.includes('$$typeof'), text)
      t.false(text.includes('inverse'), text)
    }
    // and they still match as the runner's matchers do
    t.notThrows(() => client.received(1).send(expect.objectContaining({ input: expect.objectContaining({ TransactItems: expect.arrayContaining([2]) }) })))
  })
}

// ---- E87 (R13FE-2): lines that still print alike -------------------------------------------------------------------

const CALLS_NOTE = 'Some calls print the same but do not match: functions and symbols match by identity, and #private fields and other internal state are not printed. Match such arguments with Arg.is(), or pass the same instance.'
const ASSIGNMENTS_NOTE = 'Some assignments print the same but do not match: functions and symbols match by identity, and #private fields and other internal state are not printed. Match such values with Arg.is(), or assign the same instance.'
const CUT_CALLS_NOTE = 'Some calls print the same but do not match: they can differ in what the message leaves out ([Object], more keys, items or characters), functions and symbols match by identity, and #private fields and other internal state are not printed. Match such arguments with Arg.is(), or pass the same instance.'
const CUT_ASSIGNMENTS_NOTE = 'Some assignments print the same but do not match: they can differ in what the message leaves out ([Object], more keys, items or characters), functions and symbols match by identity, and #private fields and other internal state are not printed. Match such values with Arg.is(), or assign the same instance.'
const NUMBERED = 'The substitutes are numbered in this message (@Substitute#1, @Substitute#2, ...) to tell them apart.'

/** How many times `part` is in `text`. */
const occurrences = (text: string, part: string): number => text.split(part).length - 1

test('R13FE-2 (E87) a failing check whose expected call prints exactly like a received one that it does not match ends with a note', t => {
  // an AWS SDK v3 style command: its middleware holds closures, which match by identity
  class Command {
    middleware: { use: () => void }
    constructor(public input: Record<string, unknown>) {
      this.middleware = { use: () => { } }
    }
  }
  const client = Substitute.for<any>()
  client.send(new Command({ TableName: 'inventory' }))
  const command = messageOf(() => client.received(1).send(new Command({ TableName: 'inventory' })))
  t.true(command.endsWith(`\n${CALLS_NOTE}\n`), command)
  t.is(occurrences(command, CALLS_NOTE), 1)
  // #private fields, and symbols with the same description
  class Money {
    #cents: number
    constructor(cents: number) {
      this.#cents = cents
    }
    get cents() { return this.#cents }
  }
  const bank = Substitute.for<any>()
  bank.pay(new Money(1), Symbol('x'))
  bank.pay(new Money(1), Symbol('x'))
  const money = messageOf(() => bank.received(1).pay(new Money(2), Symbol('x')))
  t.true(money.includes('matching pay(Money {}, Symbol(x)), but received none.'), money)
  // once per message, however many lines print alike
  t.true(money.endsWith(`\n${CALLS_NOTE}\n`), money)
  t.is(occurrences(money, CALLS_NOTE), 1)
  // assignments
  const config = Substitute.for<any>()
  config.onError = function handler() { }
  const assignment = messageOf(() => { config.received(1).onError = function handler() { } })
  t.true(assignment.includes('matching onError = [Function: handler], but received none.'), assignment)
  t.true(assignment.endsWith(`\n${ASSIGNMENTS_NOTE}\n`), assignment)
  // lines that print alike because the message leaves out where they differ: more than four levels down, or past the
  // keys it shows (the note says so)
  const far = Substitute.for<any>()
  far.find({ a: { b: { c: { d: { e: { f: 1 } } } } } })
  const deep = messageOf(() => far.received(1).find({ a: { b: { c: { d: { e: { f: 2 } } } } } }))
  t.true(deep.endsWith(`\n${CUT_CALLS_NOTE}\n`), deep)
  const wide = (last: number) => Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`k${index}`, index === 20 ? last : index]))
  far.update(wide(1))
  const cut = messageOf(() => far.received(1).update(wide(2)))
  t.true(cut.includes('... 1 more key'), cut)
  t.true(cut.endsWith(`\n${CUT_CALLS_NOTE}\n`), cut)
  config.limits = wide(1)
  t.true(messageOf(() => { config.received(1).limits = wide(2) }).endsWith(`\n${CUT_ASSIGNMENTS_NOTE}\n`))
  // with colours too (the texts are compared without them)
  const colors = process.env.FORCE_COLOR
  process.env.FORCE_COLOR = '1'
  try {
    let colored = ''
    try {
      client.received(1).send(new Command({ TableName: 'inventory' }))
    } catch (error) {
      colored = (error as Error).message
    }
    t.not(colored, plain(colored))
    t.true(plain(colored).endsWith(`\n${CALLS_NOTE}\n`), colored)
  } finally {
    if (colors === undefined) delete process.env.FORCE_COLOR
    else process.env.FORCE_COLOR = colors
  }
})

test('R13FE-2 (E87) no note where the lines print differently', t => {
  const bank = Substitute.for<any>()
  bank.pay({ id: 1 }, Symbol('x'))
  // a visible difference
  t.false(messageOf(() => bank.received(1).pay({ id: 1 }, Symbol('y'))).includes(CALLS_NOTE))
  // a difference further down, which the deeper re-print shows (E54)
  const repo = Substitute.for<any>()
  repo.find({ where: { user: { address: { city: 'Oslo' } } } })
  const deeper = messageOf(() => repo.received(1).find({ where: { user: { address: { city: 'Bergen' } } } }))
  t.true(deeper.includes("city: 'Bergen'"), deeper)
  t.false(deeper.includes(CALLS_NOTE), deeper)
  // lines that differ only in which substitute is the argument are numbered, and then print differently (E52)
  const app = Substitute.for<any>()
  const plugin = Substitute.for<any>()
  const bus = Substitute.for<any>()
  bus.subscribe(plugin.onEvent)
  const numbered = messageOf(() => bus.received(1).subscribe(app.onEvent))
  t.true(numbered.endsWith(`\n${NUMBERED}\n`), numbered)
  t.false(numbered.includes(CALLS_NOTE), numbered)
  // a check that matched too many calls, and lists no others
  const shop = Substitute.for<any>()
  shop.pay({ id: 1 }, Symbol.for('x'))
  shop.pay({ id: 1 }, Symbol.for('x'))
  const tooMany = messageOf(() => shop.received(1).pay({ id: 1 }, Symbol.for('x')))
  t.false(tooMany.includes(CALLS_NOTE), tooMany)
  // (one that does not match among them prints like the expected call: a symbol with the same description)
  shop.pay({ id: 1 }, Symbol('x'))
  t.true(messageOf(() => shop.received(1).pay({ id: 1 }, Symbol.for('x'))).endsWith(`\n${CALLS_NOTE}\n`))
  // a check with a matcher prints the matcher by its label
  t.false(messageOf(() => bank.received(3).pay(Arg.any(), Symbol('x'))).includes(CALLS_NOTE))
  // property checks have no arguments to compare
  bank.balance
  t.false(messageOf(() => bank.received(2).balance).includes(CALLS_NOTE))
})
