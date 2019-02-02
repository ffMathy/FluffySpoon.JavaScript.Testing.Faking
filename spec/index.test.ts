import test from 'ava';

import { Substitute, Arg } from '../src/Index';
import { areArgumentsEqual } from '../src/Utilities';
import { OmitProxyMethods, ObjectSubstitute } from '../src/Transformations';

class Dummy {

}

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

	returnPromise() {
		return Promise.resolve(new Dummy());
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

test('partial mocks using function mimicks with all args', t => {
	substitute.c(Arg.all()).mimicks(instance.c);

	t.deepEqual(substitute.c('a', 'b'), 'hello a world (b)');
});

test('can call received twice', t => { 
	substitute.c('blah', 'fuzz');

	t.throws(() => substitute.received(1337).c('foo', 'bar'), 
`Expected 1337 calls to the method c with arguments ['foo', 'bar'], but received none of such calls.
All calls received to method c:
-> 1 call with arguments ['blah', 'fuzz']`);

	t.throws(() => substitute.received(2117).c('foo', 'bar'),
`Expected 2117 calls to the method c with arguments ['foo', 'bar'], but received none of such calls.
All calls received to method c:
-> 1 call with arguments ['blah', 'fuzz']`);
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

test('class string field set received', t => {
	substitute.v = undefined;
	substitute.v = null;
	substitute.v = 'hello';
	substitute.v = 'hello';
	substitute.v = 'world';
	
	t.notThrows(() => substitute.received().v = 'hello');
	t.notThrows(() => substitute.received(5).v = Arg.any());
	t.notThrows(() => substitute.received().v = Arg.any());
	t.notThrows(() => substitute.received(2).v = 'hello');
	t.notThrows(() => substitute.received(2).v = Arg.is(x => x && x.indexOf('ll') > -1));

	t.throws(() => substitute.received(2).v = Arg.any());
	t.throws(() => substitute.received(1).v = Arg.any());
	t.throws(() => substitute.received(1).v = Arg.is(x => x && x.indexOf('ll') > -1));
	t.throws(() => substitute.received(3).v = 'hello');
});

test('class method returns with placeholder args', t => {
	substitute.c(Arg.any(), "there").returns("blah", "haha");
	
	t.is(substitute.c("hi", "there"), 'blah');
	t.is(substitute.c("his", "there"), 'haha');
	t.is<any>(substitute.c("his", "there"), void 0);
	t.is<any>(substitute.c("hi", "there"), void 0);
});

test('partial mocks using function mimicks with specific args', t => {
	substitute.c('a', 'b').mimicks(instance.c);

	t.is(substitute.c('a', 'b'), 'hello a world (b)');
});

test('class method returns with specific args', t => {
	substitute.c("hi", "there").returns("blah", "haha");

	t.is(substitute.c("hi", "there"), 'blah');
	t.is(substitute.c("hi", "there"), 'haha');
	t.is(substitute.c("hi", "there"), void 0);
	t.is(substitute.c("hi", "there"), void 0);
});

test('returning other fake from promise works', async t => {
	const otherSubstitute = Substitute.for<Dummy>();
	substitute.returnPromise().returns(Promise.resolve(otherSubstitute));

	t.is(otherSubstitute, await substitute.returnPromise());
});

test('returning resolved promises works', async t => {
	substitute.returnPromise().returns(Promise.resolve(1338));

	t.is(1338, await substitute.returnPromise());
});

test('class void returns', t => {
	substitute.foo().returns(void 0, null);

	t.is(substitute.foo(), void 0);
	t.is(substitute.foo(), null);
}); 

test('class method received', t => {
	void substitute.c("hi", "there");
	void substitute.c("hi", "the1re");
	void substitute.c("hi", "there");
	void substitute.c("hi", "there");
	void substitute.c("hi", "there");

	t.notThrows(() => substitute.received(4).c('hi', 'there'));
	t.notThrows(() => substitute.received(1).c('hi', 'the1re'));
	t.notThrows(() => substitute.received().c('hi', 'there'));

	t.throws(() => substitute.received(7).c('hi', 'there'), 
`Expected 7 calls to the method c with arguments ['hi', 'there'], but received 4 of such calls.
All calls received to method c:
-> 4 calls with arguments ['hi', 'there']
-> 1 call with arguments ['hi', 'the1re']`);
});

test('received call matches after partial mocks using property instance mimicks', t => {
	substitute.d.mimicks(() => instance.d);
	substitute.c('lala', 'bar');

	substitute.received(1).c('lala', 'bar');
	substitute.received(1).c('lala', 'bar');

	t.notThrows(() => substitute.received(1).c('lala', 'bar'));
	t.throws(() => substitute.received(2).c('lala', 'bar'),
`Expected 2 calls to the method c with arguments ['lala', 'bar'], but received 1 of such call.
All calls received to method c:
-> 1 call with arguments ['lala', 'bar']`);
	
	t.deepEqual(substitute.d, 1337);
});

test('partial mocks using property instance mimicks', t => {
	substitute.d.mimicks(() => instance.d);

	t.deepEqual(substitute.d, 1337);
});

test('are arguments equal', t => {
	t.true(areArgumentsEqual(Arg.any(), 'hi'));
	t.true(areArgumentsEqual(Arg.any('array'), ['foo', 'bar']));

	t.false(areArgumentsEqual(['foo', 'bar'], ['foo', 'bar']));
	t.false(areArgumentsEqual(Arg.any('array'), 1337));
});

test('class string field get returns', t => {
	substitute.a.returns("foo", "bar");

	t.deepEqual(substitute.a, 'foo');
	t.deepEqual(substitute.a, 'bar');
	t.deepEqual(substitute.a, void 0);
	t.deepEqual(substitute.a, void 0);
});