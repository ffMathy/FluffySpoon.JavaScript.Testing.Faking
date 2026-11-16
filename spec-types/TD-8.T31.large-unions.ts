// TD-8 / T31 Types with a member whose type is a very large union of string literals (lib.dom's HTMLInputElement,
// HTMLSelectElement and HTMLTextAreaElement have `autocomplete: AutoFill`) do not fail with TS2590 ("union type that
// is too complex to represent").
import { Substitute, Arg } from '../src'

const input = Substitute.for<HTMLInputElement>()
input.value.returns('x')
input.autocomplete.returns('on')
input.checkValidity().returns(true)
input.received().value = 'y'
input.received().focus()
const asInput: HTMLInputElement = input

const select = Substitute.for<HTMLSelectElement>()
select.value.returns('a')
select.item(Arg.any()).returns(null)
const asSelect: HTMLSelectElement = select

const textArea = Substitute.for<HTMLTextAreaElement>()
textArea.value.returns('text')
const asTextArea: HTMLTextAreaElement = textArea

// A user type with a 10 000-member template literal union
type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
type Code = `${Digit}${Digit}${Digit}${Digit}`
interface Lock {
  code: Code
  open(code: Code): boolean
  current(): Code
}
const lock = Substitute.for<Lock>()
lock.code.returns('1234')
lock.open('1234').returns(true)
lock.open(Arg.any()).returns(false)
lock.current().returns('0000')
lock.received().open('1234')
const asLock: Lock = lock

// @ts-expect-error the configured value keeps its type
lock.code.returns('12345')

export { asInput, asSelect, asTextArea, asLock }
