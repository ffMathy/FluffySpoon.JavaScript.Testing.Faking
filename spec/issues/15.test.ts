import test from 'ava';

import { Substitute } from '../../src/index';

export interface Example {
    bar: string;
}

test('issue 15: can call properties twice', t => {
    const baz = "baz";
    const foo = Substitute.for<Example>();

    foo.bar.returns(baz);

    const call1 = foo.bar;
    const call2 = foo.bar;

    t.is(call1, baz);
    t.is(call2, baz);
});