import test from 'ava';

import { Substitute, Arg } from '../../src/Index';

interface CalculatorInterface {
    add(a: number, b: number): number
    subtract(a: number, b: number): number
    divide(a: number, b: number): number
    isEnabled: boolean
}

test('issue 18: receive with arg', t => {
    const mockedCalculator = Substitute.for<CalculatorInterface>()
    mockedCalculator.add(1, Arg.is(input => input === 2)).returns(4);

    void mockedCalculator.add(1, 2);

    mockedCalculator.received(1).add(1, Arg.is(input => input === 2));

    t.pass();
});