// T:TY-16 / D20 Members the runtime special-cases.
// - `then`: a substitute never exposes it (so that it is not a thenable and `await sub` resolves to the substitute).
//   It is `never` on the substitute: calling, configuring or asserting it does not compile.
// - `toJSON`: answered by the substitute itself (it serializes the substitute). It keeps its declared type, but it has
//   no setup API and cannot be configured or asserted.
import { Substitute, Arg, configure, received } from '../src'
import { expectType } from './helpers'

interface Job {
  then(callback: (value: number) => void): void
  toJSON(): string
  run(): number
}
const j = Substitute.for<Job>()
j.run().returns(1)
expectType<string>(j.toJSON())
// The substitute is still a Job (for the code under test).
const asJob: Job = j
async function awaitsTheSubstitute() {
  const awaited = await j
  return awaited.run()
}

// @ts-expect-error `then` is never exposed by a substitute
j.then(Arg.any())
// @ts-expect-error `then` cannot be configured
j.then.returns(() => undefined)
// @ts-expect-error `toJSON` cannot be configured
j.toJSON().returns('{}')
// @ts-expect-error `toJSON` cannot be configured
j.toJSON.returns(() => '{}')
// @ts-expect-error `then` cannot be asserted
j.received().then(Arg.any())
// @ts-expect-error `toJSON` cannot be asserted
j[received]().toJSON()
// @ts-expect-error `then` cannot be configured
j[configure]().then(Arg.any())
// @ts-expect-error `toJSON` cannot be configured
j[configure]().toJSON().returns('{}')

export { asJob, awaitsTheSubstitute }
