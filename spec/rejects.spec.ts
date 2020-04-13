import test from 'ava'

import { Substitute, Arg } from '../src/index'

interface Calculator {
  getMemory(): Promise<number>;
  heavyOperation(...args: number[]): Promise<number>
  model: Promise<string>;
}

test('rejects a method with no arguments', async t => {
  const calculator = Substitute.for<Calculator>();
  calculator.getMemory().rejects(new Error('No memory'));

  await t.throwsAsync(calculator.getMemory(), { instanceOf: Error, message: 'No memory' });
});

test('rejects a method with arguments', async t => {
  const calculator = Substitute.for<Calculator>();
  calculator.heavyOperation(0, 1, 1, 2, 4, 5, 8).rejects(new Error('Wrong sequence!'));

  await t.throwsAsync(calculator.heavyOperation(0, 1, 1, 2, 4, 5, 8), { instanceOf: Error, message: 'Wrong sequence!' });
});

test.skip('rejects a property', async t => {
  const calculator = Substitute.for<Calculator>();
  calculator.model.rejects(new Error('No model'));

  await t.throwsAsync(calculator.model, { instanceOf: Error, message: 'No model' });
});
