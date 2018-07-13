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

	set v(x) {
		console.log('define: ' + x);
	}
}

let substitute: ObjectSubstitute<Example>;
test.beforeEach(() => {
	substitute = Substitute.for<Example>();
});

test('are arguments equal', t => {
	t.false(areArgumentsEqual(['foo', 'bar'], ['foo', 'bar']));

	t.true(areArgumentsEqual(Arg.any('array'), ['foo', 'bar']));
	t.true(areArgumentsEqual(Arg.is(x => x), ['foo', 'bar']));
});

test('class string field returns', t => {
	substitute.a.returns("foo", "bar");

	t.deepEqual(substitute.a, 'foo');
	t.deepEqual(substitute.a, 'bar');
	t.deepEqual(substitute.a, void 0);
	t.deepEqual(substitute.a, void 0);
});

test('class string field received', t => {
	substitute.a.returns("foo", "bar");

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
	substitute.c("hi", "there").returns("blah", "haha");
	
	void substitute.c("hi", "there");
	void substitute.c("hi", "the1re");
	void substitute.c("hi", "there");
	void substitute.c("hi", "there");
	void substitute.c("hi", "there");

	t.throws(() => substitute.received(7).c('hi', 'there'));
	t.notThrows(() => substitute.received(4).c('hi', 'there'));
	t.notThrows(() => substitute.received().c('hi', 'there'));
});