import test from 'ava';

import { Substitute, Arg } from '../../src/index';

interface IData { serverCheck: Date, data: { a: any[] } }
interface IFetch { getUpdates: (arg: Date | null) => Promise<IData>  }

test('issue 36 - promises returning object with properties', async t => {
    const emptyFetch = Substitute.for<IFetch>();
    const now = new Date();
    emptyFetch.getUpdates(null).returns(Promise.resolve<IData>({
        serverCheck: now,
        data: { a: [1] }
    }));
    const result = await emptyFetch.getUpdates(null);
    t.true(result.serverCheck instanceof Date, 'given date is instanceof Date');
    t.is(result.serverCheck, now, 'dates are the same');
    t.true(Array.isArray(result.data.a), 'deep array isArray');
    t.deepEqual(result.data.a, [1], 'arrays are deep equal');
});
