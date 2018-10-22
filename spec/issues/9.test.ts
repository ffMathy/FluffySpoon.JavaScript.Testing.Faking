// import test from 'ava';

// import { Substitute } from '../../src/Index';
// import { ObjectSubstitute } from '../../src/Transformations';

// export class Example {
// 	blocking() {
// 		console.log('blocking');
// 		return 123;
// 	}
// }

// let substitute: ObjectSubstitute<Example>;

// test.beforeEach(() => {
// 	substitute = Substitute.for<Example>();
// });


// test('issue 9: can record method with 0 arguments', t => {
// 	substitute.blocking().returns(42);
// 	substitute.blocking();
//     substitute.received(1).blocking();
//     t.pass();
// });