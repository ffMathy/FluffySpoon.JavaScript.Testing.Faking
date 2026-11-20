// R15FE-3 / T79 Checks through a call with matchers (`app.repo(Arg.any()).received(1).save(1)`, E81) work at run time,
// but in TypeScript the result of a call is typed as the member's value with the setup API, without check views (the
// typings do not change for this). Cast the call result to the substitute of the value's type, through `unknown`:
// `(app.repo(Arg.any()) as unknown as SubstituteOf<Repo>).received(1).save(1)`, and the same with the symbol forms.
// The same holds for a call result that a setup configured to return your own substitute.
import { Substitute, Arg, SubstituteOf, received, didNotReceive } from '../src'

interface Repo { save(id: number): void; name: string }
interface App { repo(name: string): Repo }
const app = Substitute.for<App>()
const repos = Substitute.for<Repo>()

// the cast compiles, in every form
;(app.repo(Arg.any()) as unknown as SubstituteOf<Repo>).received(1).save(1)
;(app.repo(Arg.any()) as unknown as SubstituteOf<Repo>).didNotReceive().save(2)
;(app.repo(Arg.any()) as unknown as SubstituteOf<Repo>)[received](1).save(1)
;(app.repo(Arg.any()) as unknown as SubstituteOf<Repo>)[didNotReceive]().save(Arg.any())
;(app.repo(Arg.is(name => name.startsWith('u'))) as unknown as SubstituteOf<Repo>).received(1).save(Arg.any())
;(app.repo(Arg.any()) as unknown as SubstituteOf<Repo>).received(1).name
// also for a setup that returns your own substitute
app.repo(Arg.any()).returns(repos)
;(app.repo(Arg.any()) as unknown as SubstituteOf<Repo>).received(1).save(1)

// without the cast, the call result has no check views
// @ts-expect-error the call result is a Repo with the setup API
app.repo(Arg.any()).received(1).save(1)
// @ts-expect-error the call result is a Repo with the setup API
app.repo(Arg.any())[didNotReceive]().save(1)
// a direct cast to the substitute type is refused (the types do not overlap enough)
// @ts-expect-error convert to unknown first
;(app.repo(Arg.any()) as SubstituteOf<Repo>).received(1).save(1)

// A function-typed member: the call result is a function with the setup API.
interface Bus { on(event: string, handler: (id: string) => void): () => void }
const bus = Substitute.for<Bus>()
;(bus.on('saved', Arg.any()) as unknown as SubstituteOf<() => void>).received(1)()
;(bus.on('saved', Arg.any()) as unknown as SubstituteOf<() => void>)[received](1)()
// @ts-expect-error no check views without the cast
bus.on('saved', Arg.any()).received(1)()
// the cast keeps the checks typed
// @ts-expect-error save takes a number
;(app.repo(Arg.any()) as unknown as SubstituteOf<Repo>).received(1).save('1')
