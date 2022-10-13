import test from 'ava'

import { Substitute, Arg } from '../../../src'

class Key {
    private constructor(private _value: string) { }
    static create() {
        return new this('123')
    }
    get value(): string {
        return this._value
    }
}
class IData {
    private constructor(private _serverCheck: Date, private _data: number[]) { }

    static create() {
        return new this(new Date(), [1])
    }

    set data(newData: number[]) {
        this._data = newData
    }

    get serverCheck(): Date {
        return this._serverCheck
    }

    get data(): number[] {
        return this._data
    }
}
abstract class IFetch {
    abstract getUpdates(arg: Key): Promise<IData>
    abstract storeUpdates(arg: IData): Promise<void>
}
class Service {
    constructor(private _database: IFetch) { }
    public async handle(arg?: Key) {
        const updateData = await this.getData(arg)
        updateData.data = [100]
        await this._database.storeUpdates(updateData)
    }
    private getData(arg?: Key) {
        if (typeof arg === 'undefined') throw new TypeError('Key is undefined')
        return this._database.getUpdates(arg)
    }
}

test('issue 36 - promises returning object with properties', async t => {
    const emptyFetch = Substitute.for<IFetch>()
    emptyFetch.getUpdates(Key.create()).returns(Promise.resolve<IData>(IData.create()))
    const result = await emptyFetch.getUpdates(Key.create())
    t.true(result.serverCheck instanceof Date, 'given date is instanceof Date')
    t.deepEqual(result.data, [1], 'arrays are deep equal')
})

test('using objects or classes as arguments should be able to match mock', async t => {
    const db = Substitute.for<IFetch>()
    const data = IData.create()
    db.getUpdates(Key.create()).returns(Promise.resolve(data))
    const service = new Service(db)

    await service.handle(Key.create())

    db.received(1).storeUpdates(Arg.is((arg: IData) =>
        arg.serverCheck instanceof Date &&
        arg instanceof IData &&
        arg.data[0] === 100
    ))
    t.pass()
})