import test from 'ava';

import { Substitute } from '../../src/index';

interface IEcho {
  echo(a: string): string
  maybeEcho(a?: string): string
}

test('issue 59 - Mock function with optional parameters', (t) => {
  const echoer = Substitute.for<IEcho>()
  echoer.maybeEcho('foo').returns('bar')
  echoer.maybeEcho().returns('baz')

  t.is(echoer.maybeEcho('foo'), 'bar')
  echoer.received().maybeEcho('foo');
  t.is(echoer.maybeEcho(), 'baz')
})
