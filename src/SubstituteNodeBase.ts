import { Recorder } from './Recorder'
import { RecordsSet } from './RecordsSet'

export abstract class SubstituteNodeBase extends Function {
  private _root: this & { parent: undefined }
  private _parent?: this
  private _child?: this
  private _depth: number

  private _recorder: Recorder<this>

  constructor(private _key: PropertyKey, parent?: SubstituteNodeBase) {
    super()
    const shouldBeRoot = !this.isNode(parent)
    if (shouldBeRoot) {
      this._recorder = Recorder.withIdentityProperty('key')
      this._root = this as this & { parent: undefined }
      this._depth = 0
      return
    }

    parent.assignChild(this)
    this._parent = parent
    this._recorder = parent.recorder
    this._root = parent.root
    this._depth = parent.depth + 1
    if (this.parent === this.root) this.recorder.addIndexedRecord(this)
  }

  private isNode(node?: SubstituteNodeBase): node is this {
    return typeof node !== 'undefined'
  }

  public get key(): PropertyKey {
    return this._key
  }

  public get recorder(): Recorder<this> {
    return this._recorder
  }

  protected get parent(): this | undefined {
    return this._parent
  }

  protected get child(): this | undefined {
    return this._child
  }

  protected get root(): this & { parent: undefined } {
    return this._root
  }

  protected get depth(): number {
    return this._depth
  }

  private assignChild(child: this): void {
    this._child = child
  }

  protected isRoot(): this is this & { parent: undefined } {
    return typeof this._parent === 'undefined'
  }

  protected isIntermediateNode(): this is this & { parent: ThisType<SubstituteNodeBase> } {
    return !this.isRoot()
  }

  protected getAllSiblings(): RecordsSet<this> {
    return this.recorder.getSiblingsOf(this)
  }

  protected hasChild(): this is this & { child: ThisType<SubstituteNodeBase> } {
    return this.child instanceof SubstituteNodeBase
  }

  public abstract read(): void
  public abstract write(value: any): void
}