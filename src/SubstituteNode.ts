import { inspect, InspectOptions, types } from 'util'

import { SubstituteNodeBase } from './SubstituteNodeBase'
import { RecordedArguments } from './RecordedArguments'
// TODO: implement rest of constants and guards (AccessorType, Context, Filter functions, ...)
import { constants, is } from './utilities'
import { SubstituteException } from './SubstituteException'
import type { FilterFunction, SubstituteContext, SubstitutionMethod, ClearType, PropertyType, SubstituteNodeModel } from './Types'
import type { ObjectSubstitute } from './Transformations'

const instance = Symbol('Substitute:Instance')
const clearTypeToFilterMap: Record<ClearType, FilterFunction<SubstituteNode>> = {
  all: () => true,
  receivedCalls: node => !node.hasContext,
  substituteValues: node => node.isSubstitution
}

type SpecialProperty = typeof instance | typeof inspect.custom | 'then'
type RootContext = { substituteMethodsEnabled: boolean }

export class SubstituteNode extends SubstituteNodeBase implements ObjectSubstitute<unknown>, SubstituteNodeModel {
  private _proxy: SubstituteNode
  private _rootContext: RootContext

  private _propertyType: PropertyType = constants.PROPERTY.property
  private _accessorType: 'get' | 'set' = 'get'
  private _recordedArguments: RecordedArguments = RecordedArguments.none()

  private _context: SubstituteContext = 'none'
  private _retrySubstitutionExecutionAttempt: boolean = false

  public stack?: string

  private constructor(key: PropertyKey, parent?: SubstituteNode) {
    super(key, parent)
    if (this.isRoot()) this._rootContext = { substituteMethodsEnabled: true }
    else this._rootContext = this.root.rootContext
    this._proxy = new Proxy(
      this,
      {
        get: function (target, property) {
          if (target.isSpecialProperty(property)) return target.evaluateSpecialProperty(property)
          if (target._retrySubstitutionExecutionAttempt) return target.reattemptSubstitutionExecution()[property]
          const newNode = SubstituteNode.createChild(property, target)
          if (target.isAssertion) newNode.executeAssertion()
          if (target.isRoot() && target.rootContext.substituteMethodsEnabled && (is.method.assertion(property) || is.method.configuration(property))) {
            newNode.assignContext(property)
            return newNode[property].bind(newNode)
          }
          Error.captureStackTrace(newNode, this.get)
          return newNode.attemptSubstitutionExecution()
        },
        set: function (target, property, value) {
          const newNode = SubstituteNode.createChild(property, target)
          newNode.handleSetter(value)
          if (target.isAssertion) newNode.executeAssertion()
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

  public static instance: typeof instance = instance

  public static createRoot(): SubstituteNode {
    return new this('*Substitute<Root>')
  }

  public static createChild(key: PropertyKey, parent: SubstituteNode): SubstituteNode {
    return new this(key, parent)
  }

  public get proxy(): SubstituteNode {
    return this._proxy
  }

  public get rootContext(): RootContext {
    return this._rootContext
  }

  get context(): SubstituteContext {
    return this._context
  }

  get hasContext(): boolean {
    return this.context !== 'none'
  }

  get isSubstitution(): boolean {
    return is.method.substitution(this.context)
  }

  get isAssertion(): boolean {
    return is.method.assertion(this.context)
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

  public received(amount?: number): SubstituteNode {
    this.handleMethod([amount])
    return this.proxy
  }

  public didNotReceive(): SubstituteNode {
    this.handleMethod([0])
    return this.proxy
  }

  public mimick() {
    throw new Error('Mimick is not implemented yet')
  }

  public clearSubstitute(clearType: ClearType = constants.CLEAR.all): void {
    this.handleMethod([clearType])
    const filter = clearTypeToFilterMap[clearType]
    this.recorder.clearRecords(filter)
  }

  public [inspect.custom](...args: [_: number, options: InspectOptions]): string {
    return types.isProxy(this) ? this[inspect.custom](...args) : this.printableForm(...args)
  }

  private assignContext(context: SubstituteContext): void {
    if (!is.method.substitute(context)) throw new Error(`Cannot assign context for property ${context.toString()}`)
    this._context = context
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
    if (!this.hasChild()) throw new TypeError('Substitue node has no child')
    if (!this.child.recordedArguments.hasArguments()) throw new TypeError('Child args')

    const substitutionMethod = this.context as SubstitutionMethod
    const substitutionValue = this.child.recordedArguments.value.length > 1
      ? this.child.recordedArguments.value?.shift()
      : this.child.recordedArguments.value[0]
    switch (substitutionMethod) {
      case 'throws':
        throw substitutionValue
      case 'mimicks':
        if (is.PROPERTY.property(this.propertyType)) return substitutionValue()
        if (!contextArguments.hasArguments()) throw new TypeError('Context arguments cannot be undefined')
        return substitutionValue(...contextArguments.value)
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

  private executeAssertion(): void | never {
    if (!this.hasDepthOfAtLeast(2)) throw new Error('Not possible')
    if (!this.parent.recordedArguments.hasArguments()) throw new TypeError('Parent args')
    const expectedCount: number | undefined = this.parent.recordedArguments.value[0] ?? undefined
    const finiteExpectation = expectedCount !== undefined
    if (finiteExpectation && (!Number.isInteger(expectedCount) || expectedCount < 0)) throw new Error('Expected count has to be a positive integer')

    const siblings = [...this.getAllSiblings().filter(n => !n.hasContext && n.accessorType === this.accessorType)]
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
    this._accessorType = 'set'
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
    if (onlySubstitutionsWithThisNodePropertyType && hasSuitableSubstitutions) return RecordedArguments.sort(strictSuitableSubstitutions)[0]
    if (!onlySubstitutionsWithThisNodePropertyType) this._retrySubstitutionExecutionAttempt = true
  }

  private isSpecialProperty(property: PropertyKey): property is SpecialProperty {
    return property === SubstituteNode.instance || property === inspect.custom || property === 'then'
  }

  private evaluateSpecialProperty(property: SpecialProperty) {
    switch (property) {
      case SubstituteNode.instance:
        return this
      case inspect.custom:
        return this.printableForm.bind(this)
      case 'then':
        return
      default:
        throw SubstituteException.generic(`Evaluation of special property ${property} is not implemented`)
    }
  }

  private printableForm(_: number, options: InspectOptions): string {
    // TODO: Refactor this to use a TextBuilder via stringify utility
    return this.isRoot() ? this.printRootNode(options) : this.printNode(options)
  }

  private printRootNode(options: InspectOptions): string {
    const records = inspect(this.recorder, options)
    const instanceName = '@Substitute'
    return instanceName + ' {' + records + '\n}'
  }

  private printNode(options: InspectOptions): string {
    const hasContext = this.hasContext
    const args = inspect(this.recordedArguments, options)
    const label = this.isSubstitution ?
      '=> ' :
      this.isAssertion ?
        `${this.child?.property.toString()}` :
        ''
    const s = hasContext ? `${label}${inspect(this.child?.recordedArguments, options)}` : ''

    const printableNode = `${this.propertyType}<${this.property.toString()}>: ${args}${s}`
    return printableNode
    // return hasContext ? textModifier.italic(printableNode) : printableNode
  }
}