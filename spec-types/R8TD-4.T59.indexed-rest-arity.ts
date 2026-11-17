// R8TD-4 / T59 Generic methods whose rest parameter is typed by an indexed access (`send<K extends keyof Events>(event:
// K, ...args: Events[K])`) check the number of arguments on a substitute from TypeScript 4.0 on (this file is checked
// with the project's TypeScript). Limitation: TypeScript 3.6 to 3.9 keep such a parameter list as one list of any
// length, so there a call with too many arguments compiles on the substitute (the interface itself rejects it).
import { Substitute, configure, received } from '../src'

interface Events { saved: [string]; moved: [string, string] }
interface Bus { send<K extends keyof Events>(event: K, ...args: Events[K]): boolean }
const bus = Substitute.for<Bus>()
bus.send('saved', 'id1').returns(true)
bus.send('moved', 'a', 'b').returns(false)
bus.received().send('saved', 'id1')
bus[configure]().send('moved', 'a', 'b').returns(true)
// @ts-expect-error no event takes three arguments (TypeScript 4.0 and newer)
bus.send('saved', 'id1', 'x', 'y')
// @ts-expect-error in a check either
bus.received().send('moved', 'a', 'b', 'c')
// @ts-expect-error nor with the symbol form
bus[received]().send('moved', 'a', 'b', 'c')
// @ts-expect-error nor in the configure view
bus[configure]().send('saved', 'a', 'b', 'c').returns(true)
const asBus: Bus = bus
// @ts-expect-error the interface rejects it on every version
asBus.send('saved', 'id1', 'x', 'y')

export { asBus }
