// R6FE-5 / T48 `Arg.any('bigint')` is typed like the other type names: it matches bigint parameters, and only those.
import { Substitute, Arg, configure } from '../src'
import { expectType, value } from './helpers'

interface Ledger {
  credit(amount: bigint): bigint
  label(id: string): string
}
const ledger = Substitute.for<Ledger>()
const one = value<bigint>()
ledger.credit(Arg.any('bigint')).returns(one)
ledger.credit(Arg.any.not('undefined')).returns(one)
ledger[configure]().credit(Arg.any('bigint')).mimicks(amount => amount + one)
ledger.received().credit(Arg.any('bigint'))
ledger.didNotReceive().credit(Arg.any('any'))
expectType<bigint>(Arg.any('bigint'))
// @ts-expect-error a bigint matcher does not fit a string parameter
ledger.label(Arg.any('bigint'))
// @ts-expect-error not a type name
Arg.any('BigInt')
