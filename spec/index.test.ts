import test from 'ava';
import { Substitute, ObjectSubstitute } from '../src/index';
import { equals } from 'src/Substitute';

export class Example {
	a = "1337";
	b = 1337;

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

test('equals', t => {
	t.true(equals([], []));
	t.true(equals(['foo'], ['foo']));

	t.false(equals([], ['foo']));
	t.false(equals(['foo', 'bar'], ['foo', 'bar', 'baz']));
});

test('class string field', t => {
	substitute.a.returns("foo", "bar");

	t.deepEqual(substitute.a, 'foo');
	t.deepEqual(substitute.a, 'bar');
	t.deepEqual(substitute.a, void 0);
	t.deepEqual(substitute.a, void 0);

	t.throws(() => substitute.received(3).a);
	t.notThrows(() => substitute.received().a);
	t.notThrows(() => substitute.received(4).a);
});

test('class number field', t => {
	substitute.b.returns(10, 30);

	t.deepEqual(substitute.b, 10); 
	t.deepEqual(substitute.b, 30); 
	t.deepEqual(substitute.b, void 0);
	t.deepEqual(substitute.b, void 0);

	t.throws(() => substitute.received(7).b);
	t.notThrows(() => substitute.received().b);
	t.notThrows(() => substitute.received(4).b);
});

test('class method', t => {
	substitute.c("hi", "there").returns("blah", "haha");
	
	t.deepEqual(substitute.c("hi", "there"), 'blah');
	t.deepEqual(substitute.c("hi", "the1re"), void 0);
	t.deepEqual(substitute.c("hi", "there"), 'haha');
	t.deepEqual(substitute.c("hi", "there"), void 0);
	t.deepEqual(substitute.c("hi", "there"), void 0);

	t.notThrows(() => substitute.received(4).c('hi', 'there'));
	t.notThrows(() => substitute.received().c('hi', 'there'));
	t.throws(() => substitute.received(7).c('hi', 'there'));
});