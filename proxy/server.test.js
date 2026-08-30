import test from 'node:test';
import assert from 'node:assert/strict';

const source = await import('./server.js');

test('converts LibreChat image parts to Responses input parts', () => {
	const input = {
		messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,x', detail: 'auto' } }] }],
		detail: 'keep',
	};

	assert.deepEqual(source.toResponsesInput(input.messages), [{
		role: 'user',
		content: [{ type: 'input_image', image_url: 'data:image/png;base64,x' }],
	}]);

	assert.deepEqual(source.toChatCompletion({
		id: 'resp_1',
		created_at: 1,
		model: 'gpt-5.6-terra',
		output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
	}), {
		id: 'resp_1',
		object: 'chat.completion',
		created: 1,
		model: 'gpt-5.6-terra',
		choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
		usage: undefined,
	});
});

test('does not forward decompression headers after fetch decodes upstream body', () => {
	const headers = new Headers({ 'content-encoding': 'gzip', 'content-length': '100', 'content-type': 'application/json' });
	const response = source.responseHeaders(headers);

	assert.equal(response['content-encoding'], undefined);
	assert.equal(response['content-length'], undefined);
	assert.equal(response['content-type'], 'application/json');
});

test('converts Chat Completions tool messages to Responses input items', () => {
	assert.deepEqual(source.toResponsesInput([
		{
			role: 'assistant',
			tool_calls: [{ id: 'call-1', function: { name: 'web_search', arguments: '{"query":"latest"}' } }],
		},
		{ role: 'tool', tool_call_id: 'call-1', content: 'search result' },
	]), [
		{ type: 'function_call', call_id: 'call-1', name: 'web_search', arguments: '{"query":"latest"}' },
		{ type: 'function_call_output', call_id: 'call-1', output: 'search result' },
	]);
});

test('converts Responses function calls to Chat Completions chunks', () => {
	assert.deepEqual(source.toChatStream({
		type: 'response.output_item.added',
		output_index: 0,
		item: { type: 'function_call', call_id: 'call-1', name: 'web_search' },
	}), {
		id: 'call-1',
		object: 'chat.completion.chunk',
		choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '' } }] }, finish_reason: null }],
	});

	assert.deepEqual(source.toChatStream({
		type: 'response.function_call_arguments.delta',
		output_index: 0,
		delta: '{"query":"latest"}',
	}), {
		object: 'chat.completion.chunk',
		choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":"latest"}' } }] }, finish_reason: null }],
	});
});

test('converts streamed Responses function calls over HTTP', async () => {
	const originalFetch = global.fetch;
	global.fetch = async (url, options) => {
		if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, options);
		return new Response([
		'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call-1","name":"web_search"}}',
		'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{}"}',
		'data: [DONE]',
	].join('\n\n') + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
	};
	await new Promise((resolve) => source.server.listen(0, resolve));
	try {
		const response = await fetch(`http://127.0.0.1:${source.server.address().port}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ model: 'gpt-5.6-terra', stream: true, messages: [{ role: 'user', content: 'search' }] }),
		});
		const body = await response.text();
		assert.match(body, /"tool_calls"/);
		assert.match(body, /data: \[DONE\]/);
	} finally {
		global.fetch = originalFetch;
		await new Promise((resolve, reject) => source.server.close((error) => error ? reject(error) : resolve()));
	}
});
