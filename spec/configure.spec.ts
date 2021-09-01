import test from "ava";
import {Arg, Substitute} from "../src";

interface Calculator {
  add(a: number, b: number): number;
  addAsync(a: number, b: number): Promise<number>;
  isEnabled: boolean;
  isEnabledAsync: Promise<boolean>;
};

test('can override method return value for the same arguments (only-primitives)', async t => {
  const calculator = Substitute.for<Calculator>();

  // initial
  calculator.add(1, 1).returns(11);
  calculator.addAsync(1, 1).resolves(11);

  t.is(calculator.add(1, 1), 11);
  t.is(await calculator.addAsync(1,1,), 11);

  // override
  calculator.configure().add(1, 1).returns(12);
  calculator.configure().addAsync(1, 1).resolves(12);

  t.is(calculator.add(1, 1), 12);
  t.is(await calculator.addAsync(1,1,), 12);
});

test('can override method return value for the same arguments (with-single-argument)', async t => {
  const calculator = Substitute.for<Calculator>();

  // initial
  calculator.add(1, Arg.any()).returns(11);
  calculator.addAsync(1, Arg.any()).resolves(11);

  t.is(calculator.add(1, 1), 11);
  t.is(await calculator.addAsync(1,1,), 11);

  // override
  calculator.configure().add(1, Arg.any()).returns(12);
  calculator.configure().addAsync(1, Arg.any()).resolves(12);

  t.is(calculator.add(1, 1), 12);
  t.is(await calculator.addAsync(1,1,), 12);
});

test('can override method return value for the same arguments (all-argument)', async t => {
  const calculator = Substitute.for<Calculator>();

  // initial
  calculator.add(Arg.all()).returns(11);
  calculator.addAsync(Arg.all()).resolves(11);

  t.is(calculator.add(1, 1), 11);
  t.is(await calculator.addAsync(1,1,), 11);

  // override
  calculator.configure().add(Arg.all()).returns(12);
  calculator.configure().addAsync(Arg.all()).resolves(12);

  t.is(calculator.add(1, 1), 12);
  t.is(await calculator.addAsync(1,1,), 12);
});

test('can change method from returning a value to throwing an exception', async t => {
  const calculator = Substitute.for<Calculator>();

  // initial
  calculator.add(1, Arg.any()).returns(11);
  calculator.addAsync(1, Arg.any()).resolves(11);

  t.is(calculator.add(1, 1), 11);
  t.is(await calculator.addAsync(1,1,), 11);

  calculator.configure().add(1, 1).throws(new Error('boom'));
  calculator.configure().addAsync(1, 1).rejects(new Error('boom'));

  t.throws(() => calculator.add(1, 1), { instanceOf: Error, message: 'boom' })
  await t.throwsAsync(calculator.addAsync(1,1), { instanceOf: Error, message: 'boom' });
});

test('can override property value', async t => {
  const calculator = Substitute.for<Calculator>();

  // initial
  calculator.isEnabled.returns(true);
  calculator.isEnabledAsync.resolves(true);

  t.is(calculator.isEnabled, true);
  t.is(await calculator.isEnabledAsync, true);

  // override
  calculator.configure().isEnabled.returns(false);
  calculator.configure().isEnabledAsync.resolves(false);

  t.is(calculator.isEnabled, false);
  t.is(await calculator.isEnabledAsync, false);
});

test('resolution respects the match-group order: only-primitives > with-single-argument > all-argument', t => {
  const calculator = Substitute.for<Calculator>();

  // note we setup with a mixed-up order
  calculator.add(1, Arg.is(x => x < 1)).returns(0);
  calculator.configure().add(Arg.all()).mimicks((a, b) => a + b);
  calculator.configure().add(1, Arg.any()).returns(1);
  calculator.configure().add(1, 1).returns(11);


  t.is(calculator.add(2, 2), 4);
  t.is(calculator.add(1, -1), 0);
  t.is(calculator.add(1, 2), 1);
  t.is(calculator.add(1, 1), 11);

  calculator.received().add(1, 1);

  calculator.configure().add(1, 1).returns(12);

  t.is(calculator.add(2, 2), 4);
  t.is(calculator.add(1, -1), 0);
  t.is(calculator.add(1, 2), 1);
  t.is(calculator.add(1, 1), 12);

  calculator.configure().add(1, Arg.is(x => x < 1)).returns(-1);

  t.is(calculator.add(2, 2), 4);
  t.is(calculator.add(1, -1), -1);
  t.is(calculator.add(1, 2), 1);
  t.is(calculator.add(1, 1), 12);
});

test.only('will reset the received counters', t => {
  const calculator = Substitute.for<Calculator>();

  // initial
  calculator.add(1, 1).returns(2);

  t.is(calculator.add(1, 1), 2);
  t.is(calculator.add(1, 1), 2);

  calculator.received(2).add(1,1);
  calculator.received(0).add(2,2);
  calculator.didNotReceive().add(2,2);


  calculator.configure().add(1, 1).returns(3);
  calculator.received(0).add(1,1);
  calculator.received(0).add(2,2);
  calculator.didNotReceive().add(2,2);

  t.is(calculator.add(1, 1), 3);

  calculator.received(1).add(1,1);
  calculator.received(0).add(2,2);
  calculator.didNotReceive().add(2,2);
});