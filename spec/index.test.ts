import test from 'ava';

import { Substitute, Arg } from '../src/Index';
import { areArgumentsEqual } from '../src/Utilities';
import { OmitProxyMethods, ObjectSubstitute } from '../src/Transformations';

export class Example {
	a = "1337";

	c(arg1: string, arg2: string) {
		return "hello " + arg1 + " world (" + arg2 + ")";
	}

	get d() {
		return 1337;
	}

	set v(x: string) {
		console.log('define: ' + x);
	}

	received(stuff: number|string) {

	}

	foo() {
		return 'stuff';
	}
}

let instance: Example;
let substitute: ObjectSubstitute<OmitProxyMethods<Example>, Example>;

test.beforeEach(() => {
	instance = new Example();
	substitute = Substitute.for<Example>();
});

test('class string field get received', t => {
	void substitute.a;
	void substitute.a;
	void substitute.a;
	void substitute.a;

	t.throws(() => substitute.received(3).a);
	t.notThrows(() => substitute.received().a);
	t.notThrows(() => substitute.received(4).a);
});

test('class void returns', t => {
	substitute.foo().returns(void 0, null);

	t.deepEqual(substitute.foo(), void 0);
	t.deepEqual(substitute.foo(), null);
});

test('class with method called "received" can be used for call count verification when proxies are suspended', t => {
	Substitute.disableFor(substitute).received(2);

	t.throws(() => substitute.received(2).received(2));
	t.notThrows(() => substitute.received(1).received(2));
});

test('class with method called "received" can be used for call count verification', t => {
	Substitute.disableFor(substitute).received('foo');

	t.notThrows(() => substitute.received(1).received('foo'));
	t.throws(() => substitute.received(2).received('foo'));
});

test('partial mocks using property instance mimicks', t => {
	substitute.d.mimicks(() => instance.d);

	t.deepEqual(substitute.d, 1337);
});

test('partial mocks using function mimicks with all args', t => {
	substitute.c(Arg.all()).mimicks(instance.c);

	t.deepEqual(substitute.c('a', 'b'), 'hello a world (b)');
});

test('class method received', t => {
	void substitute.c("hi", "there");
	void substitute.c("hi", "the1re");
	void substitute.c("hi", "there");
	void substitute.c("hi", "there");
	void substitute.c("hi", "there");

	substitute.received(4).c('hi', 'there')

	t.notThrows(() => substitute.received(4).c('hi', 'there'));
	t.notThrows(() => substitute.received(1).c('hi', 'the1re'));
	t.notThrows(() => substitute.received().c('hi', 'there'));

	const err: Error = t.throws(() => substitute.received(7).c('hi', 'there'));
	t.deepEqual(err.message, 
`Expected 7 calls to the method c with arguments [hi, there], but received 4 of such calls.
All calls received to method c:
-> 4 calls with arguments [hi, there]
-> 1 call with arguments [hi, the1re]`);
});

test('are arguments equal', t => {
	t.true(areArgumentsEqual(Arg.any(), 'hi'));
	t.true(areArgumentsEqual(Arg.any('array'), ['foo', 'bar']));

	t.false(areArgumentsEqual(['foo', 'bar'], ['foo', 'bar']));
	t.false(areArgumentsEqual(Arg.any('array'), 1337));
});

test('class method returns with placeholder args', t => {
	substitute.c(Arg.any(), "there").returns("blah", "haha");

	t.deepEqual(substitute.c("hi", "there"), 'blah');
	t.deepEqual(substitute.c("hi", "the1re"), void 0);
	t.deepEqual(substitute.c("his", "there"), 'haha');
	t.deepEqual(substitute.c("his", "there"), void 0);
	t.deepEqual(substitute.c("hi", "there"), void 0);
});

test('partial mocks using function mimicks with specific args', t => {
	substitute.c('a', 'b').mimicks(instance.c);

	t.deepEqual(substitute.c('c', 'b'), void 0);
	t.deepEqual(substitute.c('a', 'b'), 'hello a world (b)');
});

test('class method returns with specific args', t => {
	substitute.c("hi", "there").returns("blah", "haha");

	t.deepEqual(substitute.c("hi", "there"), 'blah');
	t.deepEqual(substitute.c("hi", "the1re"), void 0);
	t.deepEqual(substitute.c("hi", "there"), 'haha');
	t.deepEqual(substitute.c("hi", "there"), void 0);
	t.deepEqual(substitute.c("hi", "there"), void 0);
});

test('class string field get returns', t => {
	substitute.a.returns("foo", "bar");

	t.deepEqual(substitute.a, 'foo');
	t.deepEqual(substitute.a, 'bar');
	t.deepEqual(substitute.a, void 0);
	t.deepEqual(substitute.a, void 0);
});

test('class string field set received', t => {
	substitute.v = undefined;
	substitute.v = null;
	substitute.v = 'hello';
	substitute.v = 'hello';
	substitute.v = 'world';

	t.throws(() => substitute.received(2).v = Arg.any());
	t.throws(() => substitute.received(1).v = Arg.any());
	t.throws(() => substitute.received(1).v = Arg.is(x => x && x.indexOf('ll') > -1));
	t.throws(() => substitute.received(3).v = 'hello');
	t.notThrows(() => substitute.received().v = Arg.any());
	t.notThrows(() => substitute.received(5).v = Arg.any());
	t.notThrows(() => substitute.received().v = 'hello');
	t.notThrows(() => substitute.received(2).v = 'hello');
	t.notThrows(() => substitute.received(2).v = Arg.is(x => x && x.indexOf('ll') > -1));
});