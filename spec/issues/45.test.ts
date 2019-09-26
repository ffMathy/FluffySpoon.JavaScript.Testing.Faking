import test from 'ava';

import { Substitute, Arg } from '../../src/index';

class DependencyClass {
    public methodOne() {}
    public methodTwo(someArg: string) {}
}

class SubjectClass {
    private readonly dependency: DependencyClass;

    public constructor(dependency: DependencyClass) {
        this.dependency = dependency;
    }

    public callToMethodOne() {
        this.dependency.methodOne();
    }
    public callToMethodTwo() {
        this.dependency.methodTwo('string');
    }
}

test('issue 45 Checking received calls off at times', async t => {
    const mock = Substitute.for<DependencyClass>();
    const subject = new SubjectClass(mock);

    subject.callToMethodOne();
    subject.callToMethodTwo();

    t.notThrows(() => {
        mock.received(1).methodOne();
        mock.received(1).methodTwo(Arg.is(x => x === 'string'));
    });
});
