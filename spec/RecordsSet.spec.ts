import test, { ExecutionContext } from 'ava'

import { RecordsSet } from '../src/RecordsSet'

const dataArray = [1, 2, 3]
function* dataArrayGenerator() {
  yield* dataArray
}
const inputData = [dataArray, dataArray[Symbol.iterator](), new Set(dataArray), dataArrayGenerator(), new RecordsSet(dataArray)]
const macro = test.macro((t: ExecutionContext, ...inputData: Iterable<number>[]): void => {
  inputData.forEach(input => {
    const set = new RecordsSet(input)

    t.true(set.has(1))
    t.true(set.has(2))
    t.true(set.has(3))
    t.is(set.size, 3)
    t.deepEqual([...set], dataArray)
    t.deepEqual([...set[Symbol.iterator]()], dataArray)
    t.deepEqual([...set.values()], dataArray)

    t.false(set.delete(4))
    t.true(set.delete(3))
    t.false(set.delete(3))
    t.is(set.size, 2)

    set.clear()
    t.is(set.size, 0)
  })
})

test('behaves like a native Set object', macro, ...inputData)

test('applies a filter function everytime the iterator is consumed', t => {
  const set = new RecordsSet([1, 2, 3])
  const setWithFilter = set.filter(number => number !== 2)

  t.deepEqual([...set], [1, 2, 3])
  t.deepEqual([...setWithFilter], [1, 3])
  t.deepEqual([...setWithFilter], [1, 3])
})

test('applies a map function everytime the iterator is consumed', t => {
  const set = new RecordsSet([1, 2, 3])
  const setWithMap = set.map(number => number.toString())

  t.deepEqual([...set], [1, 2, 3])
  t.deepEqual([...setWithMap], ['1', '2', '3'])
  t.deepEqual([...setWithMap], ['1', '2', '3'])
})

test('applies and preserves the order of filter and map functions everytime the iterator is consumed', t => {
  const set = new RecordsSet([1, 2, 3])
  const setWithFilter = set.filter(number => number !== 2)
  const setWithFilterAndMap = setWithFilter.map(number => number.toString())
  const setWithFilterMapAndAnotherFilter = setWithFilterAndMap.filter(string => string === '3')

  t.deepEqual([...set], [1, 2, 3])
  t.deepEqual([...setWithFilter], [1, 3])
  t.deepEqual([...setWithFilterAndMap], ['1', '3'])
  t.deepEqual([...setWithFilterMapAndAnotherFilter], ['3'])

  t.deepEqual([...setWithFilter], [1, 3])
  t.deepEqual([...setWithFilterAndMap], ['1', '3'])
  t.deepEqual([...setWithFilterMapAndAnotherFilter], ['3'])
})