import test from 'ava';

import { Substitute } from '../../src/Index';
import { ObjectSubstitute } from '../../src/Transformations';

export class Example {
	a = "1337";

	async blocking() {
		return 123;
	}
}

let substitute = Substitute.for<Example>();

test('issue 9: can record method with 0 arguments', async t => {
	substitute.blocking().returns(Promise.resolve(42));
	async function service() {
		 return await substitute.blocking();
	}
	await service();
	substitute.received(1).blocking();
    t.pass();
});