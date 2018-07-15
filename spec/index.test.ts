import test from 'ava';
import { Substitute, ObjectSubstitute, Arg } from '../src/Index';
import { areArgumentsEqual } from '../src/Utilities';

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

	foo(): void {
		console.log('stuff');
	}
}

let substitute: ObjectSubstitute<Example>;
test.beforeEach(() => {
	substitute = Substitute.for<Example>();
});

test('are arguments equal', t => {
	t.false(areArgumentsEqual(['foo', 'bar'], ['foo', 'bar']));

	t.true(areArgumentsEqual(Arg.any('array'), ['foo', 'bar']));
});

test('class void returns', t => {
	substitute.foo().returns(void 0, null);

	t.deepEqual(substitute.foo(), void 0);
	t.deepEqual(substitute.foo(), null);
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

test('class string field get received', t => {
	void substitute.a;
	void substitute.a;
	void substitute.a;
	void substitute.a;

	t.throws(() => substitute.received(3).a);
	t.notThrows(() => substitute.received().a);
	t.notThrows(() => substitute.received(4).a);
});

test('class method returns', t => {
	substitute.c("hi", "there").returns("blah", "haha");

	t.deepEqual(substitute.c("hi", "there"), 'blah');
	t.deepEqual(substitute.c("hi", "the1re"), void 0);
	t.deepEqual(substitute.c("hi", "there"), 'haha');
	t.deepEqual(substitute.c("hi", "there"), void 0);
	t.deepEqual(substitute.c("hi", "there"), void 0);
});

test('class method received', t => {
	void substitute.c("hi", "there");
	void substitute.c("hi", "the1re");
	void substitute.c("hi", "there");
	void substitute.c("hi", "there");
	void substitute.c("hi", "there");

	t.throws(() => substitute.received(7).c('hi', 'there'));
	t.notThrows(() => substitute.received(4).c('hi', 'there'));
	t.notThrows(() => substitute.received().c('hi', 'there'));
});