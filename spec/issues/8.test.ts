import Substitute from "../../src/Index";
import test from 'ava';

class ClassA {
	constructor(){}

	methodA(): string {
		return 'abc'
	}
}

class ClassB {
	constructor(
		private classA: ClassA
	) {}

	methodB(): string {
		return this.classA.methodA();
	}

	methodB2(): string {
		return 'def'
	}
}

class ClassC {
	constructor(
		private classB: ClassB
	) {}

	methodC(): string {
		return this.classB.methodB2();
	}
}

test('issue 8: can use substitute in arguments', async t => {
    const classBMock = Substitute.for<ClassB>();
    const classC = new ClassC(classBMock);
    t.not(classC, null);
});