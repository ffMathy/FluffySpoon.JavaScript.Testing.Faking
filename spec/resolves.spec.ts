import test from 'ava';

import { Substitute, Arg } from '../src';

interface Calculator {
  getMemory(): Promise<number>;
  heavyOperation(...args: number[]): Promise<number>;
  model: Promise<string>;
}

test('resolves a method with no arguments', async t => {
  const calculator = Substitute.for<Calculator>();
  calculator.getMemory().resolves(0);

  t.is(await calculator.getMemory(), 0);
});

test('resolves a method with arguments', async t => {
  const calculator = Substitute.for<Calculator>();
  calculator.heavyOperation(0, 1, 1, 2, 3, 5, 8).resolves(13);

  t.is(await calculator.heavyOperation(0, 1, 1, 2, 3, 5, 8), 13);
});

test.skip('resolves a property', async t => {
  const calculator = Substitute.for<Calculator>();
  calculator.model.resolves('Casio FX-82');

  t.is(await calculator.model, 'Casio FX-82');
});
