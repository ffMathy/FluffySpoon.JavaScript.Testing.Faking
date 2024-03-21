import test from 'ava'

import { Substitute, Arg, SubstituteOf } from '../../src'

class Dummy {

}

export class Example {
	a = '1337';

	c(arg1: string, arg2: string) {
		return 'hello ' + arg1 + ' world (' + arg2 + ')'
	}

	get d() {
		return 1337
	}

	set v(x: string | null | undefined) {
	}

	received(stuff: number | string) {

	}

	returnPromise() {
		return Promise.resolve(new Dummy())
	}

	foo(): string | undefined | null {
		return 'stuff'
	}

	bar(a: number, b?: number): number {
		return a + (b ?? 0)
	}
}

let instance: Example
let substitute: SubstituteOf<Example>

function initialize() {
	instance = new Example()
	substitute = Substitute.for<Example>()
};

const textModifierRegex = /\x1b\[\d+m/g

test('class with method called \'received\' can be used for call count verification when proxies are suspended', t => {
	initialize()

	Substitute.disableFor(substitute).received(2)

	t.throws(() => substitute.received(2).received(2))
	t.notThrows(() => substitute.received(1).received(2))
})

test('class with method called \'received\' can be used for call count verification', t => {
	initialize()

	Substitute.disableFor(substitute).received('foo')

	t.notThrows(() => substitute.received(1).received('foo'))
	t.throws(() => substitute.received(2).received('foo'))
})

test('class string field set received', t => {
	initialize()

	const runLogic = (example: Example) => {
		example.v = undefined
		example.v = null
		example.v = 'hello'
		example.v = 'hello'
		example.v = 'world'
	}

	runLogic(substitute)


	t.notThrows(() => substitute.received().v = 'hello')
	t.notThrows(() => substitute.received(5).v = Arg.any())
	t.notThrows(() => substitute.received().v = Arg.any())
	t.notThrows(() => substitute.received(2).v = 'hello')
	t.notThrows(() => substitute.received(2).v = Arg.is(x => typeof x === 'string' && x.indexOf('ll') > -1))

	t.throws(() => substitute.received(2).v = Arg.any())
	t.throws(() => substitute.received(1).v = Arg.any())
	t.throws(() => substitute.received(1).v = Arg.is(x => typeof x === 'string' && x.indexOf('ll') > -1))
	t.throws(() => substitute.received(3).v = 'hello')
})

test('resolving promises works', async t => {
	initialize()

	substitute.returnPromise().resolves(1338)

	t.is(1338, await substitute.returnPromise() as number)
})

test('class void returns', t => {
	initialize()

	substitute.foo().returns(void 0, null)

	t.is(substitute.foo(), void 0)
	t.is(substitute.foo(), null)
})

test('class method received', t => {
	initialize()

	void substitute.c('hi', 'there')
	void substitute.c('hi', 'the1re')
	void substitute.c('hi', 'there')
	void substitute.c('hi', 'there')
	void substitute.c('hi', 'there')

	t.notThrows(() => substitute.received(4).c('hi', 'there'))
	t.notThrows(() => substitute.received(1).c('hi', 'the1re'))
	t.notThrows(() => substitute.received().c('hi', 'there'))

	const expectedMessage = 'Call count mismatch in @Substitute.c:\n' +
		`Expected to receive 7 method calls matching c('hi', 'there'), but received 4.\n` +
		'All property or method calls to @Substitute.c received so far:\n' +
		`› ✔ @Substitute.c('hi', 'there')\n` +
		`    called at <anonymous> (${process.cwd()}/spec/regression/index.test.ts:114:18)\n` +
		`› ✘ @Substitute.c('hi', 'the1re')\n` +
		`    called at <anonymous> (${process.cwd()}/spec/regression/index.test.ts:115:18)\n` +
		`› ✔ @Substitute.c('hi', 'there')\n` +
		`    called at <anonymous> (${process.cwd()}/spec/regression/index.test.ts:116:18)\n` +
		`› ✔ @Substitute.c('hi', 'there')\n` +
		`    called at <anonymous> (${process.cwd()}/spec/regression/index.test.ts:117:18)\n` +
		`› ✔ @Substitute.c('hi', 'there')\n` +
		`    called at <anonymous> (${process.cwd()}/spec/regression/index.test.ts:118:18)\n`
	const { message } = t.throws(() => { substitute.received(7).c('hi', 'there') })
	t.is(message.replace(textModifierRegex, ''), expectedMessage)
})

test('received call matches after partial mocks using property instance mimicks', t => {
	initialize()

	substitute.d.mimicks(() => instance.d)
	substitute.c('lala', 'bar')

	substitute.received(1).c('lala', 'bar')
	substitute.received(1).c('lala', 'bar')

	t.notThrows(() => substitute.received(1).c('lala', 'bar'))
	const expectedMessage = 'Call count mismatch in @Substitute.c:\n' +
		`Expected to receive 2 method calls matching c('lala', 'bar'), but received 1.\n` +
		'All property or method calls to @Substitute.c received so far:\n' +
		`› ✔ @Substitute.c('lala', 'bar')\n` +
		`    called at <anonymous> (${process.cwd()}/spec/regression/index.test.ts:145:13)\n`
	const { message } = t.throws(() => substitute.received(2).c('lala', 'bar'))
	t.is(message.replace(textModifierRegex, ''), expectedMessage)
	t.deepEqual(substitute.d, 1337)
})

test('partial mocks using property instance mimicks', t => {
	initialize()

	substitute.d.mimicks(() => instance.d)

	t.deepEqual(substitute.d, 1337)
})
