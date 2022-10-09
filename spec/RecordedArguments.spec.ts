import test from 'ava'
import { inspect } from 'util'

import { Arg } from '../src'
import { RecordedArguments } from '../src/RecordedArguments'

const testObject = { 'foo': 'bar' }
const testArray = ['a', 1, true]

// #90: Infinite recursion in deepEqual https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/blob/master/spec/issues/90.test.ts
const parent = {} as any
parent.child = parent
const root = {} as any
root.path = { to: { nested: root } }

const testFunc = () => { }
const testSymbol = Symbol()

test('records values and classifies them correctly', t => {
  const emptyArguments = RecordedArguments.from([])
  t.deepEqual(emptyArguments.value, [])
  t.is(emptyArguments.argumentsClass, 'plain')
  t.is(emptyArguments.hasArguments(), true)

  const primitivesOnlyArguments = RecordedArguments.from([1, 'Substitute', false, testSymbol, undefined, null, testFunc, {}])
  t.deepEqual(primitivesOnlyArguments.value, [1, 'Substitute', false, testSymbol, undefined, null, testFunc, {}])
  t.is(primitivesOnlyArguments.argumentsClass, 'plain')
  t.is(primitivesOnlyArguments.hasArguments(), true)

  const anyArg = Arg.any('any')
  const withSingleArgumentArguments = RecordedArguments.from([1, 'Substitute', false, testSymbol, undefined, null, testFunc, {}, anyArg])
  t.deepEqual(withSingleArgumentArguments.value, [1, 'Substitute', false, testSymbol, undefined, null, testFunc, {}, anyArg])
  t.is(withSingleArgumentArguments.argumentsClass, 'with-predicate')
  t.is(withSingleArgumentArguments.hasArguments(), true)

  const allArg = Arg.all()
  const allArgumentArguments = RecordedArguments.from([allArg])
  t.deepEqual(allArgumentArguments.value, [allArg])
  t.is(allArgumentArguments.argumentsClass, 'wildcard')
  t.is(allArgumentArguments.hasArguments(), true)
})

test('creates a valid instance for no arguments', t => {
  const args = RecordedArguments.none()

  t.is(args.value, undefined)
  t.is(args.argumentsClass, undefined)
  t.is(args.hasArguments(), false)
})

test('sorts correctly objects with RecordedArguments', t => {
  const plain1 = RecordedArguments.from([])
  const plain2 = RecordedArguments.from([1, 2])
  const withPredicate1 = RecordedArguments.from([1, Arg.any()])
  const withPredicate2 = RecordedArguments.from([Arg.any()])
  const wildcard1 = RecordedArguments.from([Arg.all()])
  const wildcard2 = RecordedArguments.from([Arg.all()])

  const wrapper = (recordedArguments: RecordedArguments[]) => recordedArguments.map(args => ({ recordedArguments: args }))
  const sortedArgs1 = RecordedArguments.sort(wrapper([wildcard1, wildcard2, withPredicate1, withPredicate2, plain1, plain2]))
  const sortedArgs2 = RecordedArguments.sort(wrapper([wildcard1, withPredicate1, plain1, withPredicate2, wildcard2, plain2]))

  t.deepEqual(sortedArgs1, wrapper([plain1, plain2, withPredicate1, withPredicate2, wildcard1, wildcard2]))
  t.deepEqual(sortedArgs2, wrapper([plain1, plain2, withPredicate1, withPredicate2, wildcard1, wildcard2]))
})

test('matches correctly with another RecordedArguments instance when none arguments are recorded', t => {
  const args = RecordedArguments.none()

  t.true(args.match(args))
  t.true(args.match(RecordedArguments.none()))

  t.false(args.match(RecordedArguments.from([])))
  t.false(RecordedArguments.from([]).match(args))
  t.false(args.match(RecordedArguments.from([undefined])))
})

test('matches correctly with another RecordedArguments instance when primitive arguments are recorded', t => {
  // single 
  t.true(RecordedArguments.from([]).match(RecordedArguments.from([])))
  t.true(RecordedArguments.from(['Substitute']).match(RecordedArguments.from(['Substitute'])))
  t.true(RecordedArguments.from([0]).match(RecordedArguments.from([0])))
  t.true(RecordedArguments.from([true]).match(RecordedArguments.from([true])))
  t.true(RecordedArguments.from([false]).match(RecordedArguments.from([false])))
  t.true(RecordedArguments.from([undefined]).match(RecordedArguments.from([undefined])))
  t.true(RecordedArguments.from([null]).match(RecordedArguments.from([null])))
  t.true(RecordedArguments.from([Symbol.for('test')]).match(RecordedArguments.from([Symbol.for('test')])))

  t.false(RecordedArguments.from(['a']).match(RecordedArguments.from(['b'])))
  t.false(RecordedArguments.from([1]).match(RecordedArguments.from([2])))
  t.false(RecordedArguments.from([true]).match(RecordedArguments.from([false])))
  t.false(RecordedArguments.from([undefined]).match(RecordedArguments.from([null])))
  t.false(RecordedArguments.from(['1']).match(RecordedArguments.from([1])))

  // multi
  t.true(RecordedArguments.from([1, 2, 3]).match(RecordedArguments.from([1, 2, 3])))

  t.false(RecordedArguments.from([1, 2, 3]).match(RecordedArguments.from([3, 2, 1])))
  t.false(RecordedArguments.from([1, 2, 3]).match(RecordedArguments.from([1, 2, 3, 4])))
  t.false(RecordedArguments.from([1, 2, 3, 4]).match(RecordedArguments.from([1, 2, 3])))
})

test('matches correctly with another RecordedArguments instance when object arguments are recorded', t => {
  // same reference
  t.true(RecordedArguments.from([testObject]).match(RecordedArguments.from([testObject])))
  t.true(RecordedArguments.from([testArray]).match(RecordedArguments.from([testArray])))
  t.true(RecordedArguments.from([testFunc]).match(RecordedArguments.from([testFunc])))
  t.true(RecordedArguments.from([parent]).match(RecordedArguments.from([parent])))
  t.true(RecordedArguments.from([root]).match(RecordedArguments.from([root])))

  // deep equal
  const objectWithSelfReference = { a: 1, b: 2 } as any
  objectWithSelfReference.c = objectWithSelfReference
  const anotherObjectWithSelfReference = { a: 1, b: 2 } as any
  anotherObjectWithSelfReference.c = anotherObjectWithSelfReference

  t.true(RecordedArguments.from([{ a: 1 }]).match(RecordedArguments.from([{ a: 1 }])))
  t.true(RecordedArguments.from([[]]).match(RecordedArguments.from([[]])))
  t.true(RecordedArguments.from([[1, 'a']]).match(RecordedArguments.from([[1, 'a']])))
  t.true(RecordedArguments.from([objectWithSelfReference]).match(RecordedArguments.from([anotherObjectWithSelfReference])))
})

test('matches correctly with another RecordedArguments instance when using a wildcard argument', t => {
  t.true(RecordedArguments.from([Arg.all()]).match(RecordedArguments.from([1, 2, 3])))
  t.true(RecordedArguments.from(['Substitute', 'JS']).match(RecordedArguments.from([Arg.all()])))
})

test('matches correctly with another RecordedArguments instance when using predicate arguments', t => {
  t.true(RecordedArguments.from([Arg.any(), Arg.any('number'), Arg.is((x: number) => x === 3), 4]).match(RecordedArguments.from([1, 2, 3, 4])))
  t.true(RecordedArguments.from(['Substitute', 'JS']).match(RecordedArguments.from([Arg.is(x => typeof x === 'string'), Arg.any('string')])))
})

test('generates custom text representation', t => {
  t.is(inspect(RecordedArguments.none()), '')
  t.is(inspect(RecordedArguments.from([])), '()')
  t.is(inspect(RecordedArguments.from([undefined])), 'undefined')
  t.is(inspect(RecordedArguments.from([undefined, 1])), '(undefined, 1)')
})