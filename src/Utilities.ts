import { inspect } from 'util'
import { RecordedArguments } from './RecordedArguments'

export enum PropertyType {
  method = 'method',
  property = 'property'
}

export type AssertionMethod = 'received' | 'didNotReceive'
export const isAssertionMethod = (property: PropertyKey): property is AssertionMethod =>
  property === 'received' || property === 'didNotReceive'

export type SubstitutionMethod = 'mimicks' | 'throws' | 'returns' | 'resolves' | 'rejects'
export const isSubstitutionMethod = (property: PropertyKey): property is SubstitutionMethod =>
  property === 'mimicks' || property === 'returns' || property === 'throws' || property === 'resolves' || property === 'rejects'

export const isSubstituteMethod = (property: PropertyKey): property is SubstitutionMethod | AssertionMethod =>
  isSubstitutionMethod(property) || isAssertionMethod(property)

export const stringifyArguments = (args: RecordedArguments) => textModifier.faint(
  args.hasNoArguments
    ? 'no arguments'
    : `arguments [${args.value.map(x => inspect(x, { colors: true })).join(', ')}]`
)

export const stringifyCalls = (calls: RecordedArguments[]) => {
  if (calls.length === 0) return ' (no calls)'

  const key = '\n-> call with '
  const callsDetails = calls.map(stringifyArguments)
  return `${key}${callsDetails.join(key)}`
}

const baseTextModifier = (str: string, modifierStart: number, modifierEnd: number) => `\x1b[${modifierStart}m${str}\x1b[${modifierEnd}m`
export const textModifier = {
  bold: (str: string) => baseTextModifier(str, 1, 22),
  faint: (str: string) => baseTextModifier(str, 2, 22),
  italic: (str: string) => baseTextModifier(str, 3, 23)
}

export const plurify = (str: string, count: number) => `${str}${count === 1 ? '' : 's'}`