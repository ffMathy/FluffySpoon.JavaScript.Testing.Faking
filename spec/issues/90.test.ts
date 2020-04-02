import test from 'ava';

import { Substitute } from '../../src/index';

test('can handle circular referenced objects', t => {
  interface Service {
    foo(a: any): string;
  }

  const s = Substitute.for<Service>();

  const parent = {} as any;
  parent.child = parent;

  const root = {} as any;
  root.path = { to: { nested: root } };

  s.foo(parent).returns('even-circular');
  s.foo(root).returns('even-nested-circular');

  t.is(s.foo(parent), 'even-circular');
  t.is(s.foo(root), 'even-nested-circular');
});

test('can handle non circular referenced objects', t => {
  interface Service {
    foo(a: any): string;
  }

  const s = Substitute.for<Service>();

  const parent = {} as any;
  parent.child = { family: true };

  s.foo(parent).returns('even-non-circular');
  t.is(s.foo(parent), 'even-non-circular');
});