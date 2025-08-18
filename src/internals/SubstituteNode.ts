import { inspect, InspectOptions, types } from 'util'

import { SubstituteNodeBase } from './SubstituteNodeBase'
import { RecordedArguments } from './RecordedArguments'
import { SubstituteException } from './SubstituteException'
import { is, stringify, transform } from './utilities'

import { constants } from './Constants'
import type { SubstituteContext, PropertyType, SubstituteNodeModel, AccessorType, SubstituteMethod, SubstitutionMethod, AssertionMethod } from './Types'
import { constants as sharedConstants } from '../shared/Constants'


export const instance = Symbol('Substitute:Instance')

type SpecialProperty = typeof instance | typeof inspect.custom | typeof Symbol.toPrimitive | 'then' | 'toJSON'
type TT = Exclude<keyof typeof sharedConstants.CONTEXT, 'none' | 'mimicks' | 'throws' | 'returns' | 'resolves' | 'rejects'>
type ObjectSubstitute<T> = {
  [P in typeof sharedConstants.CONTEXT[TT]['raw'] | typeof sharedConstants.CONTEXT[TT]['symbol']]: 
    (...args: any[]) => T | void | Promise<T> | Promise<void>
}

export class SubstituteNode extends SubstituteNodeBase implements ObjectSubstitute<unknown>, SubstituteNodeModel {
  private _proxy: SubstituteNode

  private _propertyType: PropertyType = constants.PROPERTY.property
  private _accessorType: AccessorType = constants.ACCESSOR.get
  private _recordedArguments: RecordedArguments = RecordedArguments.none()

  private _context: SubstituteContext = sharedConstants.CONTEXT.none.symbol
  private _retrySubstitutionExecutionAttempt: boolean = false

  public stack?: string

  private constructor(key: PropertyKey, parent?: SubstituteNode) {
    super(key, parent)

    this._proxy = new Proxy(
      this,
      {
        get: function (target, property) {
          if (target.isSpecialProperty(property)) {
            return target.evaluateSpecialProperty(property)
          }

          if (target._retrySubstitutionExecutionAttempt) {
            return target.reattemptSubstitutionExecution()[property]
          }

          const newNode = SubstituteNode.createChild(property, target)
          if (target.isAssertion) newNode.executeAssertion()
          const unresolvedAssertionFollowedBySubstitution = !target.hasContext && is.method.assertion(target.property) && !is.method.substitution(newNode.property)
          if (target.hasDepthOfAtLeast(1) && unresolvedAssertionFollowedBySubstitution) {
            target.assignContext(target.property)
            target[target.context as AssertionMethod](...Array.isArray(target.recordedArguments.value) ? target.recordedArguments.value : [undefined])
            if (target.isAssertion) newNode.executeAssertion()
            // if (target.isConfiguration) newNode.executeConfiguration()
          }
          if (target.isRoot() && is.method.contextValue(property) && (is.method.assertion(property) || is.method.configuration(property))) {
            newNode.assignContext(property)
            return newNode[property].bind(newNode)
          }
          Error.captureStackTrace(newNode, this.get)
          return newNode.attemptSubstitutionExecution()
        },
        set: function (target, property, value) {
          const newNode = SubstituteNode.createChild(property, target)
          newNode.handleSetter(value)
          if (target.isAssertion)
            newNode.executeAssertion()

          if (target.hasDepthOfAtLeast(1) && !target.hasContext && is.method.assertion(target.property)) {
            target.assignContext(target.property)
            target[target.property](...Array.isArray(target.recordedArguments.value) ? target.recordedArguments.value : [undefined])
            if (target.isAssertion) newNode.executeAssertion()
          }

          return true
        },
        apply: function (target, _thisArg, rawArguments) {
          target.handleMethod(rawArguments)
          if (target.hasDepthOfAtLeast(2)) {
            if (is.method.substitution(target.property)) return target.parent.assignContext(target.property)
            if (target.parent.isAssertion) return target.executeAssertion()
          }
          Error.captureStackTrace(target, this.apply)
          return target.isAssertion ? target.proxy : target.attemptSubstitutionExecution()
        }
      }
    )
  }

  public received(amount?: number | undefined) {
    return this[sharedConstants.CONTEXT.received.symbol](amount);
  }

  public didNotReceive() {
    return this[sharedConstants.CONTEXT.didNotReceive.symbol]();
  }

  public mimick(instance: unknown) {
    return this[sharedConstants.CONTEXT.mimick.symbol](instance);
  }

  public clearReceivedCalls() {
    return this[sharedConstants.CONTEXT.clearReceivedCalls.symbol]();
  }

  public static createRoot(): SubstituteNode {
    return new this('*Substitute<Root>')
  }

  public static createChild(key: PropertyKey, parent: SubstituteNode): SubstituteNode {
    return new this(key, parent)
  }

  public get proxy(): SubstituteNode {
    return this._proxy
  }

  get context(): SubstituteContext {
    return this._context
  }

  get hasContext(): boolean {
    return this.context !== sharedConstants.CONTEXT.none.symbol
  }

  get isSubstitution(): boolean {
    return is.CONTEXT.substitution(this.context)
  }

  get isAssertion(): boolean {
    return is.CONTEXT.assertion(this.context)
  }

  get property(): PropertyKey {
    return this.key
  }

  get propertyType(): PropertyType {
    return this._propertyType
  }

  get accessorType() {
    return this._accessorType
  }

  get recordedArguments(): RecordedArguments {
    return this._recordedArguments
  }

  public [sharedConstants.CONTEXT.received.symbol](amount?: number): SubstituteNode {
    this.handleMethod([amount])
    return this.proxy
  }

  public [sharedConstants.CONTEXT.didNotReceive.symbol](): SubstituteNode {
    this.handleMethod([0])
    return this.proxy
  }

  public [sharedConstants.CONTEXT.mimick.symbol](_instance: unknown) {
    throw new Error('Mimick is not implemented yet')
  }

  public [sharedConstants.CONTEXT.clearReceivedCalls.symbol](): void {
    this.handleMethod([])

    const filter = (node: SubstituteNode) => is.CONTEXT.none(node.context)
    this.recorder.clearRecords(filter)
  }

  public [inspect.custom](...args: [_: number, options: InspectOptions]): string {
    return types.isProxy(this) ? this[inspect.custom](...args) : this.printableForm(...args)
  }

  private assignContext(context: SubstituteMethod): void {
    this._context = typeof context === 'string' ? 
      transform.rawSymbolContextMap[context] : 
      context
  }

  private reattemptSubstitutionExecution(): SubstituteNode | any {
    const result = this.attemptSubstitutionExecution()
    this._retrySubstitutionExecutionAttempt = false
    return result
  }

  private attemptSubstitutionExecution(): SubstituteNode | any {
    const mostSuitableSubstitution = this.getMostSuitableSubstitution()
    return mostSuitableSubstitution instanceof SubstituteNode
      ? mostSuitableSubstitution.executeSubstitution(this.recordedArguments)
      : this.proxy
  }

  private executeSubstitution(contextArguments: RecordedArguments) {
    if (!this.hasChild())
      throw new TypeError('Substitue node has no child')

    if (!this.child.recordedArguments.hasArguments())
      throw new TypeError('Child args')

    const substitutionMethod = this.context as SubstitutionMethod
    const substitutionValue = this.child.recordedArguments.value.length > 1
      ? this.child.recordedArguments.value?.shift()
      : this.child.recordedArguments.value[0]
    switch (substitutionMethod) {
      case sharedConstants.CONTEXT.throws.symbol:
      case 'throws':
        throw substitutionValue
      case sharedConstants.CONTEXT.mimicks.symbol:
      case 'mimicks':
        if (is.PROPERTY.property(this.propertyType)) return substitutionValue()
        if (!contextArguments.hasArguments()) throw new TypeError('Context arguments cannot be undefined')
        return substitutionValue(...contextArguments.value)
      case sharedConstants.CONTEXT.resolves.symbol:
      case 'resolves':
        return Promise.resolve(substitutionValue)
      case sharedConstants.CONTEXT.rejects.symbol:
      case 'rejects':
        return Promise.reject(substitutionValue)
      case sharedConstants.CONTEXT.returns.symbol:
      case 'returns':
        return substitutionValue
      default:
        throw SubstituteException.generic(`Substitution method '${substitutionMethod}' not implemented`)
    }
  }

  private executeAssertion(): void | never {
    if (!this.hasDepthOfAtLeast(2))
      throw new Error('Depth is less than 2')

    if (!this.parent.recordedArguments.hasArguments())
      throw new Error('No parent args present')

    const expectedCount = this.parent.recordedArguments.value[0] ?? undefined
    const finiteExpectation = expectedCount !== undefined
    if (finiteExpectation && (!Number.isInteger(expectedCount) || expectedCount < 0)) {
      return
    }

    // const withContext = this.parent.property === sharedConstants.CONTEXT.received.symbol
    const withContext = false
    const siblings = [...this.getAllSiblings().filter(n => (withContext || !n.hasContext) && n.accessorType === this.accessorType)]
    const hasBeenCalled = siblings.length > 0
    const hasSiblingOfSamePropertyType = siblings.some(sibling => sibling.propertyType === this.propertyType)
    const allRecordedArguments = siblings.map(sibling => sibling.recordedArguments)
    if (
      !hasBeenCalled &&
      (!finiteExpectation || expectedCount > 0)
    ) throw SubstituteException.forCallCountMismatch( // Here we don't know here if it's a property or method, so we should throw something more generic
      { count: expectedCount, call: this },
      { matchCount: 0, calls: siblings }
    )

    if (!hasBeenCalled || hasSiblingOfSamePropertyType) {
      this._scheduledAssertionException = undefined
      const actualCount = allRecordedArguments.filter(r => r.match(this.recordedArguments)).length
      const matchedExpectation = (!finiteExpectation && actualCount > 0) || expectedCount === actualCount
      if (matchedExpectation) return
      const exception = SubstituteException.forCallCountMismatch(
        { count: expectedCount, call: this },
        { matchCount: actualCount, calls: siblings }
      )
      const potentialMethodAssertion = is.PROPERTY.property(this.propertyType) && siblings.some(sibling => is.PROPERTY.method(sibling.propertyType))
      if (potentialMethodAssertion) this.schedulePropertyAssertionException(exception)
      else throw exception
    }
  }

  private schedulePropertyAssertionException(exception: SubstituteException) {
    this._scheduledAssertionException = exception
    process.nextTick(() => {
      const nodeIsStillProperty = is.PROPERTY.property(this.propertyType)
      if (nodeIsStillProperty && this._scheduledAssertionException !== undefined) throw this._scheduledAssertionException
    })
  }

  private _scheduledAssertionException: SubstituteException | undefined

  private handleSetter(value: any) {
    this._accessorType = constants.ACCESSOR.set
    this._recordedArguments = RecordedArguments.from([value])
  }

  private handleMethod(rawArguments: any[]): void {
    this._propertyType = constants.PROPERTY.method
    this._recordedArguments = RecordedArguments.from(rawArguments)
  }

  private getMostSuitableSubstitution(): SubstituteNode | void {
    const commonSuitableSubstitutionsSet = this.getAllSiblings().filter(node => node.isSubstitution)
    const strictSuitableSubstitutionsSet = commonSuitableSubstitutionsSet.filter(
      node => node.propertyType === this.propertyType && node.recordedArguments.match(this.recordedArguments)
    )
    const potentialSuitableSubstitutionsSet = is.PROPERTY.property(this.propertyType) && !this._retrySubstitutionExecutionAttempt ?
      commonSuitableSubstitutionsSet.filter(node => is.PROPERTY.method(node.propertyType)) :
      <this[]>[]

    const strictSuitableSubstitutions = [...strictSuitableSubstitutionsSet]
    const potentialSuitableSubstitutions = [...potentialSuitableSubstitutionsSet]
    const hasSuitableSubstitutions = strictSuitableSubstitutions.length > 0
    const onlySubstitutionsWithThisNodePropertyType = potentialSuitableSubstitutions.length === 0
    if (onlySubstitutionsWithThisNodePropertyType && hasSuitableSubstitutions)
      return RecordedArguments.sort(strictSuitableSubstitutions)[0]

    if (!onlySubstitutionsWithThisNodePropertyType)
      this._retrySubstitutionExecutionAttempt = true
  }

  private isSpecialProperty(property: PropertyKey): property is SpecialProperty {
    return property === instance || property === inspect.custom || property === Symbol.toPrimitive || property === 'then' || property === 'toJSON'
  }

  private evaluateSpecialProperty(property: SpecialProperty) {
    switch (property) {
      case instance:
        return this
      case 'toJSON':
      case inspect.custom:
      case Symbol.toPrimitive:
        return this.printableForm.bind(this)

      case 'then':
        return

      default:
        throw SubstituteException.generic(`Evaluation of special property ${property} is not implemented.`)
    }
  }

  private printableForm(_: number, options: InspectOptions): string {
    return this.isRoot() ? stringify.rootNode(this, inspect(this.recorder, options)) : stringify.node(this, this.child, options)
  }
}
