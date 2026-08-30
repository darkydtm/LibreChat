const test = require('node:test');
const assert = require('node:assert/strict');
const { LB_QueueAsyncCall } = require('./queue');

test('continues with the next task when a callback fails', async () => {
  const results = [];

  await new Promise((resolve, reject) => {
    LB_QueueAsyncCall(async () => 'first', [], () => {
      results.push('first');
      throw new Error('callback failed');
    });
    LB_QueueAsyncCall(async () => 'second', [], (_error, data) => {
      results.push(data);
      try {
        assert.deepEqual(results, ['first', 'second']);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
});

test('handles rejected async callbacks without stopping the queue', async () => {
  const results = [];

  await new Promise((resolve) => {
    LB_QueueAsyncCall(async () => 'first', [], async () => {
      results.push('first');
      throw new Error('async callback failed');
    });
    LB_QueueAsyncCall(async () => 'second', [], (_error, data) => {
      results.push(data);
      assert.deepEqual(results, ['first', 'second']);
      resolve();
    });
  });
});
