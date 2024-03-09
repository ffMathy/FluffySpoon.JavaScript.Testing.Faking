import { inspect } from 'util'
import { RecordedArguments } from './RecordedArguments'
import type { AssertionMethod, ConfigurationMethod, SubstituteMethod, SubstitutionMethod, SubstituteNodeModel } from './Types'

export const PropertyType = {
  Method: 'method',
  Property: 'property'
} as const

export const isAssertionMethod = (property: PropertyKey): property is AssertionMethod =>
  property === 'received' || property === 'didNotReceive'

export const isConfigurationMethod = (property: PropertyKey): property is ConfigurationMethod => property === 'clearSubstitute' || property === 'mimick'

export const isSubstitutionMethod = (property: PropertyKey): property is SubstitutionMethod =>
  property === 'mimicks' || property === 'returns' || property === 'throws' || property === 'resolves' || property === 'rejects'

export const isSubstituteMethod = (property: PropertyKey): property is SubstituteMethod =>
  isSubstitutionMethod(property) || isConfigurationMethod(property) || isAssertionMethod(property)

export const ClearType = {
  All: 'all',
  ReceivedCalls: 'receivedCalls',
  SubstituteValues: 'substituteValues'
} as const

const stringifyArguments = (args: RecordedArguments) => args.hasArguments()
  ? `(${args.value.map(x => inspect(x, { colors: true })).join(', ')})`
  : ''

const matchBasedPrefix = (isMatch?: boolean) => {
  switch (isMatch) {
    case true: return '✔ '
    case false: return '✘ '
    default: return ''
  }
}

const matchBasedTextPartModifier = (isMatch?: boolean) => (part: TextPart) => isMatch === undefined
  ? part
  : isMatch
    ? part.faint()
    : part.bold()

export const stringifyCall = (context: { callPath: string, expectedArguments?: RecordedArguments }) => {
  return (call: SubstituteNodeModel): TextPart[] => {
    const isMatch = context.expectedArguments?.match(call.recordedArguments)
    const textBuilder = new TextBuilder()
      .add(matchBasedPrefix(isMatch))
      .add(context.callPath)
      .add(stringifyArguments(call.recordedArguments))
    if (call.stack !== undefined && isMatch !== undefined) textBuilder.newLine().add(call.stack.split('\n')[1].replace('at ', 'called at '), t => t.faint())
    return textBuilder.parts.map(matchBasedTextPartModifier(isMatch))
  }
}

export const stringifyExpectation = (expected: { count: number | undefined, call: SubstituteNodeModel }) => {
  const textBuilder = new TextBuilder()
  textBuilder.add(expected.count === undefined ? '1 or more' : expected.count.toString(), t => t.bold())
    .add(' ')
    .add(expected.call.propertyType, t => t.bold())
    .add(plurify(' call', expected.count), t => t.bold())
    .add(' matching ')
    .addParts(...stringifyCall({ callPath: expected.call.key.toString() })(expected.call).map(t => t.bold()))
  return textBuilder.parts
}

const createKey = () => {
  const textBuilder = new TextBuilder()
  textBuilder.newLine().add('› ')
  return textBuilder
}

export const stringifyReceivedCalls = (callPath: string, expected: SubstituteNodeModel, received: SubstituteNodeModel[]) => {
  const textBuilder = new TextBuilder()
  const stringify = stringifyCall({ callPath, expectedArguments: expected.recordedArguments })
  received.forEach(receivedCall => textBuilder.addParts(...createKey().parts, ...stringify(receivedCall)))
  return textBuilder.newLine().toString()
}

const baseTextModifier = (str: string, modifierStart: number, modifierEnd: number) => `\x1b[${modifierStart}m${str}\x1b[${modifierEnd}m`
export const textModifier = {
  bold: (str: string) => baseTextModifier(str, 1, 0),
  faint: (str: string) => baseTextModifier(str, 2, 0),
  italic: (str: string) => baseTextModifier(str, 3, 0)
}

const plurify = (str: string, count?: number) => `${str}${count === 1 ? '' : 's'}`

class TextPart {
  private _modifiers: string[] = []
  private readonly _value: string
  constructor(valueOrInstance: string | TextPart) {
    if (valueOrInstance instanceof TextPart) {
      this._modifiers = [...valueOrInstance._modifiers]
      this._value = valueOrInstance._value
    } else this._value = valueOrInstance
  }

  private baseTextModifier(modifier: number) {
    return `\x1b[${modifier}m`
  }

  public bold() {
    this._modifiers.push(this.baseTextModifier(1))
    return this
  }

  public faint() {
    this._modifiers.push(this.baseTextModifier(2))
    return this
  }

  public italic() {
    this._modifiers.push(this.baseTextModifier(3))
    return this
  }

  public underline() {
    this._modifiers.push(this.baseTextModifier(4))
    return this
  }

  public resetFormat(): void {
    this._modifiers = []
  }

  public clone(): TextPart {
    return new TextPart(this)
  }

  toString() {
    return this._modifiers.length > 0 ? `${this._modifiers.join('')}${this._value}\x1b[0m` : this._value
  }
}

export class TextBuilder {
  private readonly _parts: TextPart[] = []

  public add(text: string, texPartCb: (textPart: TextPart) => void = () => { }): this {
    const textPart = new TextPart(text)
    this._parts.push(textPart)
    texPartCb(textPart)
    return this
  }

  public addParts(...textParts: TextPart[]): this {
    this._parts.push(...textParts)
    return this
  }

  public newLine() {
    this._parts.push(new TextPart('\n'))
    return this
  }

  public toString() {
    return this._parts.join('')
  }

  public clone() {
    return new TextBuilder().addParts(...this._parts.map(x => x.clone()))
  }

  public get parts() {
    return this._parts
  }
}