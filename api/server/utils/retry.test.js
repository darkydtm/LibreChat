const test = require('node:test');
const assert = require('node:assert/strict');
const { retryAsync } = require('./retry');

test('retries transient failures and returns the successful result', async () => {
  let attempts = 0;
  const result = await retryAsync(async () => {
    attempts++;
    if (attempts < 3) throw Object.assign(new Error('temporary'), { status: 503 });
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('does not retry permanent client failures', async () => {
  let attempts = 0;

  await assert.rejects(
    retryAsync(async () => {
      attempts++;
      throw Object.assign(new Error('invalid'), { status: 400 });
    }),
    { message: 'invalid' },
  );
  assert.equal(attempts, 1);
});
