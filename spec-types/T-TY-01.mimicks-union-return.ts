// T:TY-1 mimicks() on methods with parameters whose return type is a union (boolean, T | undefined, enums, literal unions)
import { Substitute, Arg, mimicks } from '../src'

enum Status { Active, Disabled }

interface Validator {
  isValid(input: string): boolean
  find(id: number): string | undefined
  status(id: number): Status
  level(id: number): 'low' | 'high'
  isReady(): boolean
  enabled: boolean
}

const v = Substitute.for<Validator>()
v.isValid(Arg.any()).mimicks((input: string) => input.length > 3)
v.find(Arg.any()).mimicks((id: number) => (id > 0 ? 'found' : undefined))
v.status(Arg.all()).mimicks((id: number) => Status.Active)
v.level(1).mimicks(id => (id > 1 ? 'high' : 'low'))
v.isValid('x')[mimicks](() => true)
v.isReady().mimicks(() => false)
v.enabled.mimicks(() => true)

v.isValid('x').returns(true)
v.isValid('x').returns(false, true)
v.find(1).returns(undefined)
v.find(1).returns('a', undefined)
v.status(1).returns(Status.Disabled)

// @ts-expect-error the implementation must return the member's return type
v.isValid('x').mimicks(() => 'yes')
// @ts-expect-error the implementation must accept the member's parameters
v.find(1).mimicks((id: string) => id)
