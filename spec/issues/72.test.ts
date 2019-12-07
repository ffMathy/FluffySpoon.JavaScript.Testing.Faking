import test from "ava";

import { Substitute, Arg } from "../../src/index";

interface Calculator {
  add(a: number, b: number): number;
  subtract(a: number, b: number): number;
  divide(a: number, b: number): number;

  isEnabled: boolean;
}

test("check didNotReceive after not mocking and not calling a method", t => {
  const calculator = Substitute.for<Calculator>();

  // Do not mock and do not call
  calculator.didNotReceive().add(1, 2);
  calculator.didNotReceive().add(Arg.any(), Arg.any());
  calculator.didNotReceive().add(1, Arg.any());

  t.pass();
});

test("check didNotReceive after not mocking but calling a method", t => {
  const calculator = Substitute.for<Calculator>();

  // Do not mock, but call
  calculator.add(1, 2);

  calculator.didNotReceive().add(1, 2);
  calculator.didNotReceive().add(Arg.any(), Arg.any());
  calculator.didNotReceive().add(1, Arg.any());

  t.pass();
});

test("check didNotReceive after mocking but not calling a method", t => {
  const calculator = Substitute.for<Calculator>();

  // Mock but do not call
  calculator.add(1, 2).returns(3);

  calculator.didNotReceive().add(1, 2);
  calculator.didNotReceive().add(Arg.any(), Arg.any());
  calculator.didNotReceive().add(1, Arg.any());

  t.pass();
});

test("check didNotReceive after mocking and calling a method", t => {
  const calculator = Substitute.for<Calculator>();

  // Mock and call
  calculator.add(1, 2).returns(3);
  calculator.add(1, 2);

  calculator.didNotReceive().add(1, 2);
  calculator.didNotReceive().add(Arg.any(), Arg.any());
  calculator.didNotReceive().add(1, Arg.any());

  t.pass();
});
