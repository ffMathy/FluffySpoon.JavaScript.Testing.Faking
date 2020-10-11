import { Substitute } from './Substitute'
import { PropertyType, isSubstituteMethod } from './Utilities'
import { SubstituteJS as SubstituteBase, SubstituteException } from './SubstituteBase'
import { RecordedArguments } from './RecordedArguments'

import { Node } from './linked-list/Node'

export class ContextNode extends Node<Substitute, ContextNode> {
  private _property: PropertyKey
  private _propertyType: PropertyType = PropertyType.property
  private _arguments: RecordedArguments = RecordedArguments.noArguments()

  private _hasSubstitution: boolean = false
  private _isSubstitution: boolean = false

  private _proxy: typeof SubstituteBase

  constructor(property: PropertyKey) {
    super()

    this._property = property
    const nodeProxy: typeof SubstituteBase = new Proxy(SubstituteBase, {
      apply: (_target, _this, rawArguments?: any[]) => {
        this.handleMethod(rawArguments)
        return this.returnProxyOrSubstitution()
      },
      getPrototypeOf() {
        return SubstituteBase.prototype
      },
      // set: (_target, property, value) => (this.initialState.set(this, property, value), true),
      get: (_target, property: PropertyKey) => {
        if (property === 'prototype') Reflect.get(_target, property)

        const newNode = this.createNewNode(property)
        this.child = newNode

        return newNode.proxy
      }
    })

    this._proxy = nodeProxy
  }

  public labelAsSubstitution(): void {
    this._isSubstitution = true
  }

  get isSubstitution(): boolean {
    return this._isSubstitution
  }

  public enableSubstitution(): void {
    this._hasSubstitution = true
  }

  get hasSubstitution(): boolean {
    return this._hasSubstitution
  }

  get property() {
    return this._property
  }

  get propertyType() {
    return this._propertyType
  }

  get proxy() {
    return this._proxy
  }

  get arguments() {
    return this._arguments
  }

  public returnProxyOrSubstitution() {
    const allSubstitutions = this.findAllSubstitutions()
    const mostSuitableSubstitution = this.getMostSuitableSubstitution(allSubstitutions)

    return mostSuitableSubstitution instanceof ContextNode ?
      mostSuitableSubstitution.executeSubstitution() :
      this.proxy
  }

  public executeSubstitution() {
    return this.child.arguments.value[0] // Todo: support all substitutions, and multiple mockvalues
  }

  private createNewNode(property: PropertyKey): ContextNode {
    const newNode = new ContextNode(property)
    newNode.parent = this
    newNode.head = this.head

    return newNode
  }

  private handleMethod(rawArguments: any[]): void {
    this._propertyType = PropertyType.method
    this._arguments = RecordedArguments.from(rawArguments)

    if (isSubstituteMethod(this.property)) {
      this.labelAsSubstitution()
      if (this.isIntermediateNode()) this.parent.enableSubstitution()
    }
  }

  private findAllSubstitutions(): ContextNode[] {
    const firstNode = this.head
    const root = firstNode.parent

    const allSiblings = root.getSiblingsOf(firstNode)
    return allSiblings.filter(node => node.hasSubstitution &&
      node.propertyType === this.propertyType &&
      node.arguments.match(this.arguments)
    )
  }

  private getMostSuitableSubstitution(nodes: ContextNode[]): ContextNode {
    const sortedNodes = RecordedArguments.sort(nodes)
    return sortedNodes[0]
  }
}