// R8TD-1 / T54 Generic methods: a setup whose arguments fit the parameter list with the type parameters replaced by
// their constraints, but not the method's own generic signature, never takes `any` as the configured value. The value
// is checked against what the method returns for its constraints (as at 89e4175), in the string and symbol forms and
// in the configure view.
import { Substitute, Arg, configure, returns, resolves } from '../src'

interface Config { port: number; host: string }
interface Svc {
  getOr<K extends keyof Config>(key: K, fallback: Config[K]): Config[K]
  same<T extends string | number>(a: T, b: T): T
  log<T>(a: T, b: T): void
  wrap<T extends object>(a: T, b: T): Promise<T>
}
const svc = Substitute.for<Svc>()

// Arguments that fit the method's own signature keep their exact typing
svc.getOr('port', 1).returns(2)
svc.same(1, 2).returns(3)
svc.same('a', 'b').returns('c')
svc.log(1, 2).returns(undefined)
svc.wrap({ a: 1 }, { a: 2 }).resolves({ a: 3 })
svc.getOr(Arg.any(), Arg.any()).returns(1)
svc[configure]().getOr('host', 'h').returns('x')
// @ts-expect-error getOr('port', ...) returns a number
svc.getOr('port', 1).returns(Symbol('x'))

// Arguments that only fit the constraints: the value is checked against what the constraints give
svc.getOr('port', 'x').returns(1)
svc.same(1, 'x').returns('y')
svc.log(1, 'x').returns(undefined)
// @ts-expect-error getOr returns a number or a string
svc.getOr('port', 'x').returns(Symbol('x'))
// @ts-expect-error getOr returns a number or a string
svc.getOr('port', 'x').returns({ no: 1 })
// @ts-expect-error same returns a string or a number
svc.same(1, 'x').returns({})
// @ts-expect-error log returns nothing
svc.log(1, 'x').returns(5)
// @ts-expect-error log does not return a promise
svc.log(1, 'x').resolves(5)
// @ts-expect-error nor in the configure view
svc[configure]().log(1, 'x').returns(5)
// @ts-expect-error nor with the symbol form
svc.log(1, 'x')[returns](5)
// @ts-expect-error wrap resolves to an object
svc.wrap({ a: 1 }, { b: 2 }).resolves(5)
// @ts-expect-error nor with the symbol form
svc.wrap({ a: 1 }, { b: 2 })[resolves](5)
// @ts-expect-error nor in the configure view
svc[configure]().wrap({ a: 1 }, { b: 2 }).resolves(5)
