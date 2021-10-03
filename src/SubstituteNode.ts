import { inspect, InspectOptions } from 'util'

import { PropertyType, isSubstitutionMethod, isAssertionMethod, AssertionMethod, SubstitutionMethod, textModifier, isSubstituteMethod } from './Utilities'
import { SubstituteException } from './SubstituteException'
import { RecordedArguments } from './RecordedArguments'
import { SubstituteNodeBase } from './SubstituteNodeBase'
import { SubstituteBase } from './SubstituteBase'
import { createSubstituteProxy } from './SubstituteProxy'

type SubstituteContext = SubstitutionMethod | AssertionMethod | 'none'

export class SubstituteNode extends SubstituteNodeBase<SubstituteNode> {
  private _proxy: SubstituteNode
  private _propertyType: PropertyType = PropertyType.property
  private _accessorType: 'get' | 'set' = 'get'
  private _recordedArguments: RecordedArguments = RecordedArguments.none()

  private _context: SubstituteContext = 'none'
  private _disabledAssertions: boolean = false

  constructor(property: PropertyKey, parent: SubstituteNode | SubstituteBase) {
    super(property, parent)
    this._proxy = createSubstituteProxy(
      this,
      {
        get: (node, _, __, nextNode) => {
          if (node.isAssertion) nextNode.executeAssertion()
        },
        set: (node, _, __, ___, nextNode) => {
          if (node.isAssertion) nextNode.executeAssertion()
        },
        apply: (node, _, rawArguments) => {
          node.handleMethod(rawArguments)
          return node.parent?.isAssertion ?? false ? node.executeAssertion() : node.read()
        }
      }
    )
  }

  public get proxy() {
    return this._proxy
  }

  get context(): SubstituteContext {
    return this._context
  }

  get hasContext(): boolean {
    return this.context !== 'none'
  }

  get isSubstitution(): boolean {
    return isSubstitutionMethod(this.context)
  }

  get isAssertion(): boolean {
    return isAssertionMethod(this.context)
  }

  get property() {
    return this.key
  }

  get propertyType() {
    return this._propertyType
  }

  get accessorType() {
    return this._accessorType
  }

  get recordedArguments() {
    return this._recordedArguments
  }

  public get disabledAssertions() {
    return this._disabledAssertions
  }

  public assignContext(context: SubstituteContext): void {
    this._context = context
  }

  public disableAssertions() {
    this._disabledAssertions = true
  }

  public read(): SubstituteNode | void | never {
    if (this.parent?.isSubstitution ?? false) return
    if (this.isAssertion) return this.proxy

    const mostSuitableSubstitution = this.getMostSuitableSubstitution()
    return mostSuitableSubstitution instanceof SubstituteNode
      ? mostSuitableSubstitution.executeSubstitution(this.recordedArguments)
      : this.proxy
  }

  public write(value: any) {
    this._accessorType = 'set'
    this._recordedArguments = RecordedArguments.from([value])
  }

  public executeSubstitution(contextArguments: RecordedArguments) {
    const substitutionMethod = this.context as SubstitutionMethod
    const substitutionValue = this.child.recordedArguments.value.length > 1
      ? this.child.recordedArguments.value.shift()
      : this.child.recordedArguments.value[0]
    switch (substitutionMethod) {
      case 'throws':
        throw substitutionValue
      case 'mimicks':
        const argumentsToApply = this.propertyType === PropertyType.property ? [] : contextArguments.value
        return substitutionValue(...argumentsToApply)
      case 'resolves':
        return Promise.resolve(substitutionValue)
      case 'rejects':
        return Promise.reject(substitutionValue)
      case 'returns':
        return substitutionValue
      default:
        throw SubstituteException.generic(`Substitution method '${substitutionMethod}' not implemented`)
    }
  }

  public executeAssertion(): void | never {
    const siblings = [...this.getAllSiblings().filter(n => !n.hasContext && n.accessorType === this.accessorType)]
    if (!this.isIntermediateNode()) throw new Error('Not possible')

    const expectedCount = this.parent.recordedArguments.value[0] ?? undefined
    const finiteExpectation = expectedCount !== undefined
    if (finiteExpectation && (!Number.isInteger(expectedCount) || expectedCount < 0)) throw new Error('Expected count has to be a positive integer')

    const hasRecordedCalls = siblings.length > 0
    const allRecordedArguments = siblings.map(sibling => sibling.recordedArguments)

    if (
      !hasRecordedCalls &&
      (!finiteExpectation || expectedCount > 0)
    ) throw SubstituteException.forCallCountMissMatch( // Here we don't know here if it's a property or method, so we should throw something more generic
      { expected: expectedCount, received: 0 },
      { type: this.propertyType, value: this.property },
      { expected: this.recordedArguments, received: allRecordedArguments }
    )

    if (!hasRecordedCalls || siblings.some(sibling => sibling.propertyType === this.propertyType)) {
      const actualCount = allRecordedArguments.filter(r => r.match(this.recordedArguments)).length
      const matchedExpectation = (!finiteExpectation && actualCount > 0) || expectedCount === actualCount

      if (!matchedExpectation) throw SubstituteException.forCallCountMissMatch(
        { expected: expectedCount, received: actualCount },
        { type: this.propertyType, value: this.property },
        { expected: this.recordedArguments, received: allRecordedArguments }
      )
    }
  }

  public handleMethod(rawArguments: any[]): void {
    this._propertyType = PropertyType.method
    this._recordedArguments = RecordedArguments.from(rawArguments)
    if (!isSubstituteMethod(this.property)) return

    if (this.isIntermediateNode() && isSubstitutionMethod(this.property)) return this.parent.assignContext(this.property)
    if (this.disabledAssertions || !this.isHead()) return

    this.assignContext(this.property)
    if (this.context === 'didNotReceive') this._recordedArguments = RecordedArguments.from([0])
  }

  private getMostSuitableSubstitution(): SubstituteNode {
    const nodes = this.getAllSiblings().filter(node => node.isSubstitution &&
      node.propertyType === this.propertyType &&
      node.recordedArguments.match(this.recordedArguments)
    )
    const sortedNodes = RecordedArguments.sort([...nodes])
    return sortedNodes[0]
  }

  protected printableForm(_: number, options: InspectOptions): string {
    const hasContext = this.hasContext
    const args = inspect(this.recordedArguments, options)
    const label = this.isSubstitution
      ? '=> '
      : this.isAssertion
        ? `${this.child.property.toString()}`
        : ''
    const s = hasContext
      ? ` ${label}${inspect(this.child?.recordedArguments, options)}`
      : ''

    const printableNode = `${this.propertyType}<${this.property.toString()}>: ${args}${s}`
    return hasContext ? textModifier.italic(printableNode) : printableNode
  }
}