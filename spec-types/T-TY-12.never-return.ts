// T:TY-12 Members that return `never` can be configured with .throws() (and .mimicks()).
import { Substitute, Arg, throws } from '../src'

interface Guard {
  fail(message: string): never
  abort(): never
}
const g = Substitute.for<Guard>()
g.fail('boom').throws(new Error('boom'))
g.fail(Arg.any()).throws(new Error('boom'))
g.abort().throws(new Error('abort'))
g.abort()[throws](new Error('abort'))
g.fail(Arg.all()).mimicks((message: string) => { throw new Error(message) })
g.received().fail('boom')

// @ts-expect-error nothing can be returned from a member that never returns
g.abort().returns(1)
