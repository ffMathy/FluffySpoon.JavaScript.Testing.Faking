import test from 'ava'

import { Substitute, received, returns } from '../../../src'

interface IEcho {
  echo(a: string): string
  maybeEcho(a?: string): string
}

test('issue 59 - Mock function with optional parameters', (t) => {
  const echoer = Substitute.for<IEcho>()
  echoer.maybeEcho('foo').returns('bar')
  echoer.maybeEcho().returns('baz')

  t.is('bar', echoer.maybeEcho('foo'))
  echoer.received().maybeEcho('foo')
  t.is('baz', echoer.maybeEcho())
})
