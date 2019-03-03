import test from 'ava';
import { Substitute, Arg } from '../../src/index';

type Addands = {
    op1: number;
    op2: number;
}

class RealCalculator {
    add(addands: Addands): number {
        return addands.op1 + addands.op2;
    }
}

test('issue 11: arg.is is only called once', async t => {
    let mockedCalculator = Substitute.for<RealCalculator>();
    mockedCalculator.add(Arg.any()).returns(4);

    let count = 0;
    mockedCalculator.add({ op1: 1, op2: 2 });

    mockedCalculator.received(1).add(Arg.is(a => {
        count++;
        return a.op1 === 1 && a.op2 === 2;
    }));

    t.is(count, 1);
});