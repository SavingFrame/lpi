import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRequest } from '../dist/src/api/security.js';

test('desktop Origin allowlisting never grants a new HTTP Host or accepts opaque origins', () => {
  const config = { port: 3141, origins: ['pim-app://app'] };
  for (const preflight of [false, true]) {
    assert.doesNotThrow(() =>
      validateRequest(
        {
          headers: { host: '127.0.0.1:3141', origin: 'pim-app://app' },
        },
        config,
        preflight,
      ),
    );
  }
  for (const headers of [
    { host: 'app', origin: 'pim-app://app' },
    { host: '127.0.0.1:3141', origin: 'null' },
    { host: '127.0.0.1:3141', origin: 'pim-app://other' },
    { host: '127.0.0.1:3141', origin: 'pim-app://app.evil' },
  ]) {
    assert.throws(() => validateRequest({ headers }, config));
  }
  assert.throws(() =>
    validateRequest(
      {
        headers: { host: '127.0.0.1:3141', origin: 'pim-app://app' },
      },
      { port: 3141, origins: [] },
    ),
  );
});
