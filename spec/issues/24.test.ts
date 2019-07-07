import test from 'ava';

import { Substitute } from '../../src/index';

interface IHaveOptionalArguments {
  onlyOptional(a?: number): number;
  mandatoryAndOptional(a: number, b?: number): number;
}
test('issue 24 - Mocked method arguments not allowed when verifying method was called', async t => {
  const substitute = Substitute.for<IHaveOptionalArguments>();
  substitute.onlyOptional().returns(1);
  substitute.onlyOptional(2).returns(2);

  t.is(substitute.onlyOptional(), 1);
  t.is(substitute.onlyOptional(2), 2);

  substitute.mandatoryAndOptional(1).returns(1);
  substitute.mandatoryAndOptional(1, 2).returns(2);

  t.is(substitute.mandatoryAndOptional(1), 1);
  t.is(substitute.mandatoryAndOptional(1, 2), 2);
});
