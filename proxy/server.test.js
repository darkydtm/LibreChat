import test from 'node:test';
import assert from 'node:assert/strict';

const source = await import('./server.js');

test('removes detail only from image_url objects', () => {
	const input = {
		messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,x', detail: 'auto' } }] }],
		detail: 'keep',
	};

	assert.deepEqual(source.stripImageDetail(input), {
		messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }] }],
		detail: 'keep',
	});
});

test('does not forward decompression headers after fetch decodes upstream body', async () => {
	const source = await import('./server.js');
	const headers = new Headers({ 'content-encoding': 'gzip', 'content-length': '100', 'content-type': 'application/json' });
	const response = source.responseHeaders(headers);

	assert.equal(response['content-encoding'], undefined);
	assert.equal(response['content-length'], undefined);
	assert.equal(response['content-type'], 'application/json');
});
