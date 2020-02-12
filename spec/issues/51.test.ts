import test from 'ava';

import { Substitute, Arg } from '../../src/index';

interface ICalculator {
    add(a: number, b: number): number;
    divide(a: number, b: number): number;
}
test('issue 51 - All functions shares the same state', async t => {
    const calculator = Substitute.for<ICalculator>();
    calculator.add(1, 2).returns(4);

    const result = calculator.add(1, 2);
    t.is(result, 4);
    try {
        calculator.received().divide(1, 2);
    } catch (e) {
        t.regex(e.toString(), /Error: there is no mock for property: divide/);
    }
});
