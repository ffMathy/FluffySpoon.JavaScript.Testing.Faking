import test from 'ava'
import { Substitute, Arg } from '../../src'
import { mimicks } from '../../src/Transformations'

interface Calculator {
  add(a: number, b: number): number
  multiply(a: number, b?: number): number
  clear(): void
  getMemory(): Promise<number>
  viewResult(back?: number): number
  heavyOperation(...input: number[]): Promise<boolean>
  isEnabled: boolean
  model: Promise<string>
};

test('mimicks a method with specific arguments', t => {
  const calculator = Substitute.for<Calculator>()
  const addMimick = (a: number, b: number) => a + b

  calculator.add(1, 1)[mimicks](addMimick)
  t.is(2, calculator.add(1, 1))
})

test('mimicks a method with specific and conditional arguments', t => {
  const calculator = Substitute.for<Calculator>()
  const addMimick = (a: number, b: number) => a + b

  calculator.add(Arg.any('number'), Arg.is((input: number) => input >= 0 && input <= 10))[mimicks](addMimick)
  calculator.add(42, -42)[mimicks]((a: number, b: number) => 0)

  t.is(1240, calculator.add(1234, 6))
  t.is(0, calculator.add(42, -42))
})

test('mimicks a method with Arg.all', t => {
  const calculator = Substitute.for<Calculator>()
  const addMimick = (a: number, b: number) => a + b


  calculator.add(Arg.all())[mimicks](addMimick)
  t.is(100, calculator.add(42, 58))
})

test('mimicks a method with optional arguments', t => {
  const calculator = Substitute.for<Calculator>()
  const multiplyOneArgMimicks = (a: number) => a * a
  const multiplyMimicks = (a: number, b?: number) => a * (b ?? 0)

  calculator.multiply(0, Arg.is((b: number) => b > 10 && b < 20))[mimicks](multiplyMimicks)
  calculator.multiply(Arg.any('number'), Arg.is((b: number) => b === 2))[mimicks](multiplyMimicks)
  calculator.multiply(2)[mimicks](multiplyOneArgMimicks)

  t.is(0, calculator.multiply(0, 13))
  t.is(84, calculator.multiply(42, 2))
  t.is(4, calculator.multiply(2))
})

test('mimicks a method where it\'s only argument is optional', t => {
  const calculator = Substitute.for<Calculator>()

  calculator.viewResult()[mimicks](() => 0)
  calculator.viewResult(3)[mimicks](() => 42)

  t.is(0, calculator.viewResult())
  t.is(42, calculator.viewResult(3))
})