import test from 'ava'

import { Recorder } from '../src/Recorder'
import { RecordsSet } from '../src/RecordsSet'
import { Substitute } from '../src/Substitute'
import { SubstituteNodeBase } from '../src/SubstituteNodeBase'
import { returns } from '../src'

const nodeFactory = (key: string) => {
  const node = Substitute.for<SubstituteNodeBase>()
  node.key[returns](key)
  return node
}

const node = nodeFactory('node')
const otherNode = nodeFactory('otherNode')
const otherNodeDifferentInstance = nodeFactory('otherNode')

test('adds all records once only', t => {
  const recorder = Recorder.withIdentityProperty<SubstituteNodeBase>('key')
  recorder.addRecord(node)
  recorder.addRecord(node)
  recorder.addRecord(otherNode)
  recorder.addRecord(otherNode)
  recorder.addRecord(otherNodeDifferentInstance)

  const allRecords = [...recorder.records]
  t.deepEqual(allRecords, [node, otherNode, otherNodeDifferentInstance])
})

test('indexes all records correctly', t => {
  const recorder = Recorder.withIdentityProperty<SubstituteNodeBase>('key')
  recorder.addIndexedRecord(node)
  recorder.addIndexedRecord(node)
  recorder.addIndexedRecord(otherNode)
  recorder.addIndexedRecord(otherNode)
  recorder.addIndexedRecord(otherNodeDifferentInstance)

  const allRecords = [...recorder.records]
  t.deepEqual(allRecords, [node, otherNode, otherNodeDifferentInstance])

  const nodeSet = recorder.indexedRecords.get(node.key)
  t.true(nodeSet instanceof RecordsSet)
  t.deepEqual([...nodeSet!], [node])

  const otherNodeSet = recorder.indexedRecords.get(otherNode.key)
  t.true(otherNodeSet instanceof RecordsSet)
  t.deepEqual([...otherNodeSet!], [otherNode, otherNodeDifferentInstance])
})

test('returns all sibling nodes', t => {
  const recorder = Recorder.withIdentityProperty<SubstituteNodeBase>('key')
  recorder.addIndexedRecord(node)
  recorder.addIndexedRecord(otherNode)
  recorder.addIndexedRecord(otherNodeDifferentInstance)

  const nodeSiblings = recorder.getSiblingsOf(node)
  t.deepEqual([...nodeSiblings], [])

  const otherNodeSiblings = recorder.getSiblingsOf(otherNode)
  t.deepEqual([...otherNodeSiblings], [otherNodeDifferentInstance])

  const otherNodeDifferentInstanceSiblings = recorder.getSiblingsOf(otherNodeDifferentInstance)
  t.deepEqual([...otherNodeDifferentInstanceSiblings], [otherNode])
})

test('clears recorded nodes by a given filter function', t => {
  const recorder = Recorder.withIdentityProperty<SubstituteNodeBase>('key')
  recorder.addIndexedRecord(node)
  recorder.addIndexedRecord(otherNode)
  recorder.addIndexedRecord(otherNodeDifferentInstance)

  recorder.clearRecords(n => n.key === otherNode.key)
  t.deepEqual([...recorder.records], [node])
  t.deepEqual([...recorder.indexedRecords.get(node.key)!], [node])
  t.is(recorder.indexedRecords.get(otherNode.key), undefined)

  recorder.clearRecords(_ => true)
  t.deepEqual([...recorder.records], [])
  t.deepEqual(recorder.indexedRecords.get(node.key), undefined)
})
