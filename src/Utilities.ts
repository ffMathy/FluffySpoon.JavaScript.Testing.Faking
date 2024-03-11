import { inspect } from 'util'
import { RecordedArguments } from './RecordedArguments'
import type { AssertionMethod, ConfigurationMethod, SubstituteMethod, SubstitutionMethod } from './Types'
import { ClearReceivedCallsPropertyKey, DidNotReceivePropertyKey, MimickPropertyKey, MimicksPropertyKey, ReceivedPropertyKey, RejectsPropertyKey, ResolvesPropertyKey, ReturnsPropertyKey, ThrowsPropertyKey, clearReceivedCalls, didNotReceive, mimick, mimicks, received, rejects, resolves, returns, throws } from './Transformations'

export const PropertyType = {
  Method: 'method',
  Property: 'property'
} as const

export const isAssertionMethod = (property: PropertyKey): property is AssertionMethod =>
  isReceivedFunction(property) || 
  isDidNotReceiveFunction(property)

export const isConfigurationMethod = (property: PropertyKey): property is ConfigurationMethod => 
  isClearReceivedCallsFunction(property) || 
  isMimickFunction(property)

export const isSubstitutionMethod = (property: PropertyKey): property is SubstitutionMethod =>
  isMimicksFunction(property) || 
  isReturnsFunction(property) || 
  isThrowsFunction(property) || 
  isResolvesFunction(property) || 
  isRejectsFunction(property)

export const isSubstituteMethod = (property: PropertyKey): property is SubstituteMethod =>
  isSubstitutionMethod(property) || 
  isConfigurationMethod(property) || 
  isAssertionMethod(property)

export const stringifyArguments = (args: RecordedArguments) => textModifier.faint(
  args.hasArguments() ?
    `arguments [${args.value.map(x => inspect(x, { colors: true })).join(', ')}]` :
    'no arguments'
)

export const stringifyCalls = (calls: RecordedArguments[]) => {
  if (calls.length === 0) 
    return ' (no calls)'

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

export const plurify = (str: string, count?: number) => `${str}${count === 1 ? '' : 's'}`

export function isDidNotReceiveFunction(property: PropertyKey): property is DidNotReceivePropertyKey {
  return property === didNotReceive || property === 'didNotReceive'
}

export function isReceivedFunction(property: PropertyKey): property is ReceivedPropertyKey {
  return property === received || property === 'received'
}

export function isClearReceivedCallsFunction(property: PropertyKey): property is ClearReceivedCallsPropertyKey {
  return property === clearReceivedCalls || property === 'clearReceivedCalls'
}

export function isMimickFunction(property: PropertyKey): property is MimickPropertyKey {
  return property === mimick || property === 'mimick'
}

export function isRejectsFunction(property: PropertyKey): property is RejectsPropertyKey {
  return property === rejects || property === 'rejects'
}

export function isResolvesFunction(property: PropertyKey): property is ResolvesPropertyKey {
  return property === resolves || property === 'resolves'
}

export function isThrowsFunction(property: PropertyKey): property is ThrowsPropertyKey {
  return property === throws || property === 'throws'
}

export function isReturnsFunction(property: PropertyKey): property is ReturnsPropertyKey {
  return property === returns || property === 'returns'
}

export function isMimicksFunction(property: PropertyKey): property is MimicksPropertyKey {
  return property === mimicks || property === 'mimicks'
}

// https://www.totaltypescript.com/concepts/the-prettify-helper
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};