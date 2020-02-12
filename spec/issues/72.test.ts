import test from "ava";

import { Substitute, Arg } from "../../src/index";

interface Calculator {
  add(a: number, b: number): number;
  mode: boolean;
  fakeSetting: boolean;
}

test("check didNotReceive and received after not mocking and not calling a method or property", t => {
  const calculator = Substitute.for<Calculator>();

  // Do not mock and do not call

  calculator.received(0).add(1, 2);
  t.throws(() => { calculator.received(1).add(1, 2) });
  calculator.didNotReceive().add(Arg.any(), Arg.any());
  calculator.didNotReceive().add(1, Arg.any());
  calculator.didNotReceive().add(1, 2);

  calculator.received(0).mode;
  t.throws(() => { calculator.received(1).mode });
  calculator.didNotReceive().mode;

  calculator.received(0).fakeSetting = true;
  t.throws(() => { calculator.received(1).fakeSetting = true });
  calculator.didNotReceive().fakeSetting = true;
});

test("check didNotReceive and received after not mocking but calling a method or property", t => {
  const calculator = Substitute.for<Calculator>();

  // Do not mock, but call
  calculator.add(1, 2);
  void calculator.mode;
  calculator.fakeSetting = true;

  calculator.received(1).add(1, 2);
  calculator.received(0).add(2, 2);
  t.throws(() => { calculator.received(1).add(2, 2) });
  t.throws(() => { calculator.didNotReceive().add(Arg.any(), Arg.any()) });
  t.throws(() => { calculator.didNotReceive().add(1, Arg.any()) });
  t.throws(() => { calculator.didNotReceive().add(1, 2) });

  calculator.received(1).mode;
  t.throws(() => { calculator.received(0).mode });
  t.throws(() => { calculator.didNotReceive().mode });

  calculator.received(1).fakeSetting = true;
  t.throws(() => { calculator.received(0).fakeSetting = true });
  t.throws(() => { calculator.didNotReceive().fakeSetting = true });
});

test("check didNotReceive and received after mocking but not calling a method or property", t => {
  const calculator = Substitute.for<Calculator>();

  // Mock but do not call
  calculator.add(1, 2).returns(3);
  calculator.mode.returns(true);

  calculator.received(0).add(1, 2);
  t.throws(() => { calculator.received(1).add(1, 2) });
  calculator.didNotReceive().add(Arg.any(), Arg.any());
  calculator.didNotReceive().add(1, Arg.any());
  calculator.didNotReceive().add(1, 2);

  calculator.received(0).mode;
  t.throws(() => { calculator.received(1).mode });
  calculator.didNotReceive().mode;
});

test("check didNotReceive and received after mocking and calling a method or property", t => {
  const calculator = Substitute.for<Calculator>();

  // Mock and call
  calculator.add(1, 2).returns(3);
  calculator.add(1, 2);
  calculator.mode.returns(true);
  void calculator.mode;
  calculator.fakeSetting.returns(true);
  calculator.fakeSetting = true;

  calculator.received(1).add(1, 2);
  t.throws(() => { calculator.received(0).add(1, 2) });
  t.throws(() => { calculator.received(2).add(1, 2) });
  t.throws(() => { calculator.didNotReceive().add(Arg.any(), Arg.any()) });
  t.throws(() => { calculator.didNotReceive().add(1, Arg.any()) });
  t.throws(() => { calculator.didNotReceive().add(1, 2) });

  calculator.received(1).mode;
  t.throws(() => { calculator.received(0).mode });
  t.throws(() => { calculator.didNotReceive().mode });

  calculator.received(1).fakeSetting = true;
  t.throws(() => { calculator.received(0).fakeSetting = true });
  t.throws(() => { calculator.didNotReceive().fakeSetting = true });
});