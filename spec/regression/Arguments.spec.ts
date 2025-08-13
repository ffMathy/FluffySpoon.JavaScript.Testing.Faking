import test from 'ava'
import { Arg } from '../../src'
import { Argument } from '../../src/shared'

const testObject = { "foo": "bar" }
const testArray = ["a", 1, true]

const parent = {} as any
parent.child = parent
const root = {} as any
root.path = { to: { nested: root } }
const testFunc = () => { }

test('should match any argument(s) using Arg.all', t => {
  t.true(Arg.all().matches([]))
  t.true(Arg.all().matches([0]))
  t.true(Arg.all().matches([1]))
  t.true(Arg.all().matches(['string']))
  t.true(Arg.all().matches([true]))
  t.true(Arg.all().matches([false]))
  t.true(Arg.all().matches([null]))
  t.true(Arg.all().matches([undefined]))
  t.true(Arg.all().matches([1, 2]))
  t.true(Arg.all().matches(['string1', 'string2']))
})

test('should match any argument using Arg.any', t => {
  t.true(Arg.any().matches('hi'))
  t.true(Arg.any().matches(1))
  t.true(Arg.any().matches(0))
  t.true(Arg.any().matches(false))
  t.true(Arg.any().matches(true))
  t.true(Arg.any().matches(null))
  t.true(Arg.any().matches(undefined))
  t.true(Arg.any().matches(testObject))
  t.true(Arg.any().matches(testArray))
  t.true(Arg.any().matches(testFunc))
  t.true(Arg.any().matches())
  t.true(Arg.any().matches(parent))
  t.true(Arg.any().matches(root))
  t.true(Arg.any().matches(parent))
  t.true(Arg.any().matches(root))
})

test('should not match any argument using Arg.any.not', t => {
  t.false(Arg.any.not().matches('hi'))
  t.false(Arg.any.not().matches(1))
  t.false(Arg.any.not().matches(0))
  t.false(Arg.any.not().matches(false))
  t.false(Arg.any.not().matches(true))
  t.false(Arg.any.not().matches(null))
  t.false(Arg.any.not().matches(undefined))
  t.false(Arg.any.not().matches(testObject))
  t.false(Arg.any.not().matches(testArray))
  t.false(Arg.any.not().matches(testFunc))
  t.false(Arg.any.not().matches())
  t.false(Arg.any.not().matches(parent))
  t.false(Arg.any.not().matches(root))
  t.false(Arg.any.not().matches(parent))
  t.false(Arg.any.not().matches(root))
})

test('should match the type of the argument using Arg.any', t => {
  t.true(Arg.any('string').matches('foo'))
  t.true(Arg.any('number').matches(1))
  t.true(Arg.any('boolean').matches(true))
  t.true(Arg.any('symbol').matches(Symbol()))
  t.true((<Argument<unknown>>Arg.any('undefined')).matches(undefined))
  t.true(Arg.any('object').matches(testObject))
  t.true(Arg.any('array').matches(testArray))
  t.true(Arg.any('function').matches(testFunc))
  t.true(Arg.any('object').matches(parent))
  t.true(Arg.any('object').matches(root))

  t.false((<Argument<unknown>>Arg.any('string')).matches(1))
  t.false((<Argument<unknown>>Arg.any('number')).matches('string'))
  t.false((<Argument<unknown>>Arg.any('boolean')).matches(null))
  t.false((<Argument<unknown>>Arg.any('object')).matches('foo'))
  t.false((<Argument<unknown>>Arg.any('array')).matches('bar'))
  t.false((<Argument<unknown>>Arg.any('function')).matches('foo'))
})

test('should not match the type of the argument using Arg.any.not', t => {
  t.false(Arg.any.not('string').matches('123'))
  t.false(Arg.any.not('number').matches(123))
  t.false(Arg.any.not('boolean').matches(true))
  t.false(Arg.any.not('symbol').matches(Symbol()))
  t.false((<Argument<unknown>>Arg.any.not('undefined')).matches(undefined))
  t.false(Arg.any.not('object').matches(testObject))
  t.false(Arg.any.not('array').matches(testArray))
  t.false(Arg.any.not('function').matches(testFunc))
  t.false(Arg.any.not('object').matches(parent))
  t.false(Arg.any.not('object').matches(root))
})

test('should match the argument with the predicate function using Arg.is', t => {
  t.true(Arg.is<string>(x => x === 'foo').matches('foo'))
  t.true(Arg.is<number>(x => x % 2 == 0).matches(4))

  t.false(Arg.is<string>(x => x === 'foo').matches('bar'))
  t.false(Arg.is<number>(x => x % 2 == 0).matches(3))
})

test('should not match the argument with the predicate function using Arg.is.not', t => {
  t.false(Arg.is.not<string>(x => x === 'foo').matches('foo'))
  t.false(Arg.is.not<number>(x => x % 2 == 0).matches(4))

  t.true(Arg.is.not<string>(x => x === 'foo').matches('bar'))
  t.true(Arg.is.not<number>(x => x % 2 == 0).matches(3))
})
