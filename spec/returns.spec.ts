import test from 'ava';
import { inspect } from 'util'

import { Substitute, Arg } from '../src';
import { getCorrectConstructorDescriptor } from './util/compatibility';

interface Calculator {
  add(a: number, b: number): number;
  multiply(a: number, b?: number): number;
  clear(): void;
  getMemory(): Promise<number>;
  viewResult(back?: number): number;
  heavyOperation(...input: number[]): Promise<boolean>;
  isEnabled: boolean;
  model: Promise<string>;
};

test('returns a primitive value for method with no arguments', t => {
  const calculator = Substitute.for<Calculator>();
  calculator.clear().returns();

  t.is(calculator.clear(), void 0);
});

test('returns a primitive value for method with specific arguments', t => {
  const calculator = Substitute.for<Calculator>();
  const noResult = calculator.add(1, 1);

  calculator.add(1, 1).returns(2);

  t.is(calculator.add(1, 1), 2);
  t.is(calculator.add(1, 1), 2);
  t.is(inspect(noResult.constructor), `[${getCorrectConstructorDescriptor()} SubstituteJS]`);
});

test('returns a primitive value for method with specific arguments where the last argument is optional', t => {
  const calculator = Substitute.for<Calculator>();

  calculator.multiply(2).returns(4);
  calculator.multiply(0, Arg.any('number')).returns(0);
  calculator.multiply(1, Arg.any()).returns(10);

  t.is(calculator.multiply(2), 4);
  t.is(calculator.multiply(0, 10), 0);
  t.is(calculator.multiply(1), 10);
  t.is(calculator.multiply(1, 10), 10);

  const noResult = calculator.multiply(2, 2);
  const noResult2 = calculator.multiply(0);

  t.is(inspect(noResult.constructor), `[${getCorrectConstructorDescriptor()} SubstituteJS]`);
  t.is(inspect(noResult2.constructor), `[${getCorrectConstructorDescriptor()} SubstituteJS]`);
});

test('returns a primitive value for method with specific and conditional arguments', t => {
  const calculator = Substitute.for<Calculator>();
  calculator.add(0, 0).returns(0);
  calculator.add(1, Arg.is((input: number) => input === 1)).returns(2);
  calculator.add(2, Arg.any('number')).returns(10);
  calculator.add(Arg.is((input: number) => input > 2), Arg.any('number')).returns(42);

  const results = [calculator.add(0, 0), calculator.add(1, 1), calculator.add(2, 100), calculator.add(42, 84)];

  t.deepEqual(results, [0, 2, 10, 42]);
});

test('returns a primitive value for method with Arg.all', t => {
  // #25: call verification does not work when using Arg.all() to set up return values https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/issues/25
  const calculator = Substitute.for<Calculator>();
  calculator.add(Arg.all()).returns(42);

  const results = [calculator.add(0, 0), calculator.add(1, 1), calculator.add(2, 100)];

  t.deepEqual(results, [42, 42, 42]);
});

test('returns a primitive value for method with one optional argument', t => {
  // #24: Mocked method arguments not allowed when verifying method was called https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/issues/24
  const calculator = Substitute.for<Calculator>();
  calculator.viewResult().returns(0);
  calculator.viewResult(3).returns(123);

  t.is(calculator.viewResult(), 0);
  t.is(calculator.viewResult(3), 123);
});

test('returns a promise for method with no arguments', async t => {
  const calculator = Substitute.for<Calculator>();
  calculator.getMemory().returns(Promise.resolve(42))

  t.is(await calculator.getMemory(), 42);
});

test('returns a promise for method with specific arguments', async t => {
  const calculator = Substitute.for<Calculator>();
  calculator.heavyOperation(1, 1).returns(Promise.resolve(true));

  const result = await calculator.heavyOperation(1, 1);
  const noResult = calculator.heavyOperation(1, 1, 1);

  t.is(result, true);
  t.is(inspect(noResult.constructor), `[${getCorrectConstructorDescriptor()} SubstituteJS]`);
});

test('returns a promise for method with specific and conditional arguments', async t => {
  const calculator = Substitute.for<Calculator>();
  calculator.heavyOperation(0).returns(Promise.resolve(true));
  calculator.heavyOperation(1, Arg.is((input: number) => input === 1)).returns(Promise.resolve(false));
  calculator.heavyOperation(2, Arg.any('number'), 100).returns(Promise.resolve(true));

  const results = await Promise.all([calculator.heavyOperation(0), calculator.heavyOperation(1, 1), calculator.heavyOperation(2, 4321, 100)]);

  t.deepEqual(results, [true, false, true]);
});

test('returns a promise for method with Arg.all', async t => {
  const calculator = Substitute.for<Calculator>();
  calculator.heavyOperation(Arg.all()).returns(Promise.resolve(true));

  const results = await Promise.all([calculator.heavyOperation(0), calculator.heavyOperation(4321, 11, 42, 1234), calculator.heavyOperation(-1, 444)]);

  t.deepEqual(results, [true, true, true]);
});

test('returns different primitive values in the specified order for method with arguments', t => {
  const calculator = Substitute.for<Calculator>();
  calculator.add(1, Arg.any()).returns(1, NaN);

  t.is(calculator.add(1, 1), 1);
  t.is(calculator.add(1, 0), NaN);
  t.is(calculator.add(1, 1), void 0);
  t.is(calculator.add(1, 5), void 0);
});

test('returns another substituted instance for method with arguments', t => {
  const calculator = Substitute.for<Calculator>();
  const addResult = Substitute.for<number>();
  addResult.toLocaleString().returns('What a weird number');
  calculator.add(1, Arg.any()).returns(addResult);

  const result = calculator.add(1, 1);

  t.is(result, <number>addResult);
  t.is(result.toLocaleString(), 'What a weird number');
});

test('returns a primitive value on a property', t => {
  // #15: can call properties twice https://github.com/ffMathy/FluffySpoon.JavaScript.Testing.Faking/issues/15
  const calculator = Substitute.for<Calculator>();
  const noResult = calculator.isEnabled;

  calculator.isEnabled.returns(true);

  t.is(calculator.isEnabled, true);
  t.is(calculator.isEnabled, true);
  t.is(inspect(noResult.constructor), `[${getCorrectConstructorDescriptor()} SubstituteJS]`);
});

test('returns a promise on a property', async t => {
  const calculator = Substitute.for<Calculator>();
  calculator.model.returns(Promise.resolve('Casio FX-82'));

  t.is(await calculator.model, 'Casio FX-82');
});

test('returns different primitive values in the specified order on a property', t => {
  const calculator = Substitute.for<Calculator>();
  calculator.isEnabled.returns(false, true);

  t.is(calculator.isEnabled, false);
  t.is(calculator.isEnabled, true);
  t.is(calculator.isEnabled, void 0);
  t.is(calculator.isEnabled, void 0);
});

test('returns another substituted instance on a property', async t => {
  const calculator = Substitute.for<Calculator>();
  const modelResult = Substitute.for<string>();
  modelResult.replace(Arg.all()).returns('TI-83');
  calculator.model.returns(Promise.resolve(modelResult));

  const result = await calculator.model;

  t.is(result, modelResult);
  t.is(result.replace('...', '---'), 'TI-83');
});