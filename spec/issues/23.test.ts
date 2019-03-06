import test from "ava";

import { Substitute, Arg } from "../../src/Index";

interface CalculatorInterface {
  add(a: number, b: number): number;
  subtract(a: number, b: number): number;
  divide(a: number, b: number): number;
  isEnabled: boolean;
}

test("issue 23: mimick received should not call method", t => {
  const mockedCalculator = Substitute.for<CalculatorInterface>();

  mockedCalculator.add(Arg.all()).mimicks((a, b) => {
    t.deepEqual(a, 1);
    return a + b;
  });

  mockedCalculator.add(1, 1); // ok

  mockedCalculator.received(1).add(2, 1); // not ok, calls mimick func
});
