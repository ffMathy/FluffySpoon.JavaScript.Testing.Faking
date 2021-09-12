import { SubstituteBase } from './SubstituteBase'
import { SubstituteNode } from './SubstituteNode'

type BeforeNodeExecutionHook<T extends object> = {
  [Handler in keyof ProxyHandler<T>]?: (...args: [..._: Parameters<ProxyHandler<T>[Handler]>, node: SubstituteNode | undefined, proxy: ProxyHandler<T>]) => void
}
export const createSubstituteProxy = <T extends SubstituteBase>(beforeNodeExecutionHook: BeforeNodeExecutionHook<T>) => ({
  get: function (this: SubstituteBase, ...args) {
    const [target, property] = args
    if (target.isSpecialProperty(property)) return target.evaluateSpecialProperty(property)
    const newNode = new SubstituteNode(property, target)
    beforeNodeExecutionHook.get(...args, newNode, this)
    return newNode.read()
  },
  set: function (...args) {
    const [target, property, value] = args
    const newNode = new SubstituteNode(property, target)
    newNode.write(value)
    beforeNodeExecutionHook.set(...args, newNode, this)
    return true
  },
  apply: function (...args) {
    return beforeNodeExecutionHook.apply(...args, undefined, this)

  }
}) as ProxyHandler<T>