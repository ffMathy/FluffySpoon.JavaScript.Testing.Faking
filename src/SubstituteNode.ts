import { inspect, InspectOptions, types } from 'util'

import { SubstituteNodeBase } from './SubstituteNodeBase'
import { RecordedArguments } from './RecordedArguments'
import { ClearType as ClearTypeMap, PropertyType as PropertyTypeMap, isAssertionMethod, isSubstituteMethod, isSubstitutionMethod, textModifier } from './Utilities'
import { SubstituteException } from './SubstituteException'
import type { FilterFunction, SubstituteContext, SubstitutionMethod, ClearType, PropertyType } from './Types'

const instance = Symbol('Substitute:Instance')
const clearTypeToFilterMap: Record<ClearType, FilterFunction<SubstituteNode>> = {
  all: () => true,
  receivedCalls: node => !node.hasContext,
  substituteValues: node => node.isSubstitution
}

type SpecialProperty = typeof instance | typeof inspect.custom | 'then'
type RootContext = { substituteMethodsEnabled: boolean }

export class SubstituteNode extends SubstituteNodeBase {
  private _proxy: SubstituteNode
  private _rootContext: RootContext

  private _propertyType: PropertyType = PropertyTypeMap.Property
  private _accessorType: 'get' | 'set' = 'get'
  private _recordedArguments: RecordedArguments = RecordedArguments.none()

  private _context: SubstituteContext = 'none'
  private _disabledSubstituteMethods: boolean = false

  private constructor(key: PropertyKey, parent?: SubstituteNode) {
    super(key, parent)
    if (this.isRoot()) this._rootContext = { substituteMethodsEnabled: true }
    else this._rootContext = this.root.rootContext
    this._proxy = new Proxy(
      this,
      {
        get: function (target, property) {
          if (target.isSpecialProperty(property)) return target.evaluateSpecialProperty(property)
          const newNode = SubstituteNode.createChild(property, target)
          if (target.isRoot() && !target.rootContext.substituteMethodsEnabled) newNode.disableSubstituteMethods()
          if (target.isIntermediateNode() && target.isAssertion) newNode.executeAssertion()
          return newNode.read()
        },
        set: function (target, property, value) {
          const newNode = SubstituteNode.createChild(property, target)
          newNode.write(value)
          if (target.isAssertion) newNode.executeAssertion()
          return true
        },
        apply: function (target, _thisArg, rawArguments) {
          target.handleMethod(rawArguments)
          if (target.hasContext) target.handleSpecialContext()
          return (target.parent?.isAssertion ?? false) ? target.executeAssertion() : target.read()
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
    return isSubstitutionMethod(this.context)
  }

  get isAssertion(): boolean {
    return isAssertionMethod(this.context)
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

  public get disabledSubstituteMethods(): boolean {
    return this._disabledSubstituteMethods
  }

  public assignContext(context: SubstituteContext): void {
    this._context = context
  }

  public disableSubstituteMethods() {
    this._disabledSubstituteMethods = true
  }

  public read(): SubstituteNode | void | never {
    if ((this.parent?.isSubstitution ?? false) || this.context === 'clearSubstitute') return
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

  public clear() {
    if (!this.recordedArguments.hasArguments()) throw new TypeError('No args')
    const clearType: ClearType = this.recordedArguments.value[0] ?? ClearTypeMap.All
    const filter = clearTypeToFilterMap[clearType]
    this.recorder.clearRecords(filter)
  }

  public executeSubstitution(contextArguments: RecordedArguments) {
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
        if (this.propertyType === PropertyTypeMap.Property) return substitutionValue()
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

  public executeAssertion(): void | never {
    if (!this.isIntermediateNode()) throw new Error('Not possible')
    if (!this.parent.recordedArguments.hasArguments()) throw new TypeError('Parent args')
    const siblings = [...this.getAllSiblings().filter(n => !n.hasContext && n.accessorType === this.accessorType)]

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
    this._propertyType = PropertyTypeMap.Method
    this._recordedArguments = RecordedArguments.from(rawArguments)
    this.tryToAssignContext()
  }

  private tryToAssignContext() {
    if (!isSubstituteMethod(this.property)) return
    if (this.isIntermediateNode() && isSubstitutionMethod(this.property)) return this.parent.assignContext(this.property)
    if (this.disabledSubstituteMethods) return
    this.assignContext(this.property)
  }

  private handleSpecialContext(): void {
    if (this.context === 'clearSubstitute') return this.clear()
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

  public [inspect.custom](...args: [_: number, options: InspectOptions]): string {
    return types.isProxy(this) ? this[inspect.custom](...args) : this.printableForm(...args)
  }

  private printableForm(_: number, options: InspectOptions): string {
    return this.isRoot() ? this.printRootNode(options) : this.printNode(options)
  }

  private printRootNode(options: InspectOptions): string {
    const records = inspect(this.recorder, options)
    const instanceName = '*Substitute<Root>' // Substitute<FooThing>
    return instanceName + ' {' + records + '\n}'
  }

  private printNode(options: InspectOptions): string {
    const hasContext = this.hasContext
    const args = inspect(this.recordedArguments, options)
    const label = this.isSubstitution
      ? '=> '
      : this.isAssertion
        ? `${this.child?.property.toString()}`
        : ''
    const s = hasContext
      ? ` ${label}${inspect(this.child?.recordedArguments, options)}`
      : ''

    const printableNode = `${this.propertyType}<${this.property.toString()}>: ${args}${s}`
    return hasContext ? textModifier.italic(printableNode) : printableNode
  }
}