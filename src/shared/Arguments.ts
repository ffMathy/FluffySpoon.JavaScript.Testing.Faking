export type PredicateFunction<T> = (arg: T) => boolean
export type ArgumentOptions = {
  inverseMatch?: boolean
}
class BaseArgument<T> {
  private _description: string
  constructor(
    description: string,
    private _matchingFunction: PredicateFunction<T>,
    private _options?: ArgumentOptions
  ) {
    this._description = `${this._options?.inverseMatch ? 'Not ' : ''}${description}`
  }

  matches(arg: T) {
    const inverseMatch = this._options?.inverseMatch ?? false
    return inverseMatch ? !this._matchingFunction(arg) : this._matchingFunction(arg)
  }

  toString() {
    return this._description
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return this._description
  }
}

export class Argument<T> extends BaseArgument<T> {
  private readonly _type = 'SingleArgument';
  get type(): 'SingleArgument' {
    return this._type
  }
}

export class AllArguments<T extends any[]> extends BaseArgument<T> {
  private readonly _type = 'AllArguments';
  constructor() {
    super('Arg.all{}', () => true, {})
  }
  get type(): 'AllArguments' {
    return this._type // TODO: Needed?
  }
}
