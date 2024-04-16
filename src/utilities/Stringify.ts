import { InspectOptions, inspect } from 'node:util'
import { RecordedArguments } from '../RecordedArguments'
import { SubstituteNodeModel } from '../Types'
import { TextBuilder, TextPart } from './TextBuilder'
import * as is from './Guards'

const stringifyArguments = (args: RecordedArguments, options?: InspectOptions) => args.hasArguments()
  ? `(${args.value.map(x => inspect(x, { colors: true, ...options })).join(', ')})`
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

const stringifyCall = (context: { callPath: string, expectedArguments?: RecordedArguments }) => {
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

const plurify = (str: string, count?: number) => `${str}${count === 1 ? '' : 's'}`

const stringifyExpectation = (expected: { count: number | undefined, call: SubstituteNodeModel }) => {
  const textBuilder = new TextBuilder()
  textBuilder.add(expected.count === undefined ? '1 or more' : expected.count.toString(), t => t.bold())
    .add(' ')
    .add(expected.call.propertyType, t => t.bold())
    .add(plurify(' call', expected.count), t => t.bold())
    .add(' matching ')
    .addParts(...stringifyCall({ callPath: expected.call.property.toString() })(expected.call).map(t => t.bold()))
  return textBuilder.parts
}

const createKey = () => {
  const textBuilder = new TextBuilder()
  textBuilder.newLine().add('› ')
  return textBuilder
}

const stringifyReceivedCalls = (callPath: string, expected: SubstituteNodeModel, received: SubstituteNodeModel[]) => {
  const textBuilder = new TextBuilder()
  const stringify = stringifyCall({ callPath, expectedArguments: expected.recordedArguments })
  received.forEach(receivedCall => textBuilder.addParts(...createKey().parts, ...stringify(receivedCall)))
  return textBuilder.newLine().toString()
}

const stringifyRootNode = (_node: SubstituteNodeModel, stringifiedChildNodes: string) => {
  const instanceName = '@Substitute'
  return instanceName + ' {' + stringifiedChildNodes + '\n}'

}

const stringifyNode = (node: SubstituteNodeModel, childNode: SubstituteNodeModel | undefined, options: InspectOptions) => {
  const hasContext = !is.CONTEXT.none(node.context)
  const args = stringifyArguments(node.recordedArguments, options)
  const label = is.CONTEXT.substitution(node.context) ?
    ' => ' :
    is.CONTEXT.assertion(node.context) ?
      `${childNode?.property.toString()}` :
      ''
  const s = hasContext ? `${label}${inspect(childNode?.recordedArguments, options)}` : ''

  return `${node.propertyType}<${node.property.toString()}>: ${args}${s}`
}

export const stringify = {
  call: stringifyCall,
  expectation: stringifyExpectation,
  receivedCalls: stringifyReceivedCalls,
  rootNode: stringifyRootNode,
  node: stringifyNode
}
