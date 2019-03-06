import test from 'ava';

import { Substitute, Arg } from '../../src/Index';

interface CalculatorInterface {
    add(a: number, b: number): number
    subtract(a: number, b: number): number
    divide(a: number, b: number): number
    isEnabled: boolean
}

test('issue 25_2', t => {
    const calc = Substitute.for<CalculatorInterface>();
    calc.add(Arg.all()).returns(1337);
    calc.add(2, 5);

    t.notThrows(() => calc.received().add(2, 5));
});

test('issue 25_1: call verification does not work when using Arg.all() to set up return values', t => {
    const calc = Substitute.for<CalculatorInterface>();
    calc.add(Arg.all()).returns(1337);
    calc.add(2, 5);

    t.throws(() => calc.received().add(3, 4));
});