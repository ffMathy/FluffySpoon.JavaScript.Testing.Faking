import test from 'ava';

import { Substitute } from '../../src/Index';
import { ObjectSubstitute } from '../../src/Transformations';

export interface Example {
    bar: string;
}

let substitute: ObjectSubstitute<Example>;

test.beforeEach(() => {
	substitute = Substitute.for<Example>();
});


test('issue 15: can call properties twice', t => {
    const baz = "baz";
    const foo = Substitute.for<Example>();

    foo.bar.returns(baz);

    const call1 = foo.bar;
    const call2 = foo.bar;

    t.is(call1, baz);
    t.is(call2, baz);
});