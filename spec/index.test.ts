import test from 'ava';
import { Substitute, ObjectSubstitute } from '../src/index';

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

test('class string field', t => {
	substitute.a.returns("foo", "bar");
	t.deepEqual(substitute.a, 'foo');
	t.deepEqual(substitute.a, 'bar');
	t.deepEqual(substitute.a, void 0);
	t.deepEqual(substitute.a, void 0);
});

test('class number field', t => {
	substitute.b.returns(10, 30);
	t.deepEqual(substitute.b, 10); 
	t.deepEqual(substitute.b, 30); 
	t.deepEqual(substitute.b, void 0);
	t.deepEqual(substitute.b, void 0);
});

test('class method', t => {
	substitute.c("hi", "there").returns("blah", "haha");
	t.deepEqual(substitute.c("hi", "there"), 'blah');
	t.deepEqual(substitute.c("hi", "the1re"), void 0);
	t.deepEqual(substitute.c("hi", "there"), 'haha');
	t.deepEqual(substitute.c("hi", "there"), void 0);
	t.deepEqual(substitute.c("hi", "there"), void 0);
});