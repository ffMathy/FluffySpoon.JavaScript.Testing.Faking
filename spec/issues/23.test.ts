import test from 'ava';

import { Substitute, Arg } from '../../src/Index';

interface CalculatorInterface {
    add(a: number, b: number): number
    subtract(a: number, b: number): number
    divide(a: number, b: number): number
    isEnabled: boolean
}

test('issue 23: mimick received should not call method', t => {
    const mockedCalculator = Substitute.for<CalculatorInterface>();

    let result = 0;
    mockedCalculator.add(Arg.all()).mimicks((a, b) => {
        return result = a + b;
    });

    t.throws(() => mockedCalculator.received().add(Arg.any(), Arg.any()));

    t.is(result, 0);
});