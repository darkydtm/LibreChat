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

test('does not forward decompression headers after fetch decodes upstream body', () => {
	const headers = new Headers({ 'content-encoding': 'gzip', 'content-length': '100', 'content-type': 'application/json' });
	const response = source.responseHeaders(headers);

	assert.equal(response['content-encoding'], undefined);
	assert.equal(response['content-length'], undefined);
	assert.equal(response['content-type'], 'application/json');
});

test('passes tool calls through as Chat Completions', async () => {
	const originalFetch = global.fetch;
	global.fetch = async (url, options) => {
		if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
		const body = JSON.parse(options.body);
		assert.equal(body.tools[0].type, 'function');
		assert.equal(body.tools[0].function.name, 'web_search');
		return new Response(JSON.stringify({
			choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
		}), { headers: { 'content-type': 'application/json' } });
	};
	await new Promise((resolve) => source.server.listen(0, resolve));
	try {
		const response = await fetch(`http://127.0.0.1:${source.server.address().port}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ model: 'gpt-5.6-terra', messages: [{ role: 'user', content: 'search' }], tools: [{ type: 'function', function: { name: 'web_search', parameters: { type: 'object' } } }] }),
		});
		assert.equal(response.status, 200);
		assert.deepEqual((await response.json()).choices[0].finish_reason, 'tool_calls');
	} finally {
		global.fetch = originalFetch;
		await new Promise((resolve, reject) => source.server.close((error) => error ? reject(error) : resolve()));
	}
});

test('returns upstream errors instead of an empty successful stream', async () => {
	const originalFetch = global.fetch;
	global.fetch = async (url, options) => {
		if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
		return new Response(JSON.stringify({ error: { message: 'upstream unavailable' } }), { status: 502 });
	};
	await new Promise((resolve) => source.server.listen(0, resolve));
	try {
		const response = await fetch(`http://127.0.0.1:${source.server.address().port}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ model: 'gpt-5.6-terra', stream: true, messages: [{ role: 'user', content: 'search' }] }),
		});
		assert.equal(response.status, 502);
		assert.match(await response.text(), /upstream unavailable/);
	} finally {
		global.fetch = originalFetch;
		await new Promise((resolve, reject) => source.server.close((error) => error ? reject(error) : resolve()));
	}
});
