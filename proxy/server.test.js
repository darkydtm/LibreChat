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

test('does not forward decompression headers after fetch decodes upstream body', async () => {
	const source = await import('./server.js');
	const headers = new Headers({ 'content-encoding': 'gzip', 'content-length': '100', 'content-type': 'application/json' });
	const response = source.responseHeaders(headers);

	assert.equal(response['content-encoding'], undefined);
	assert.equal(response['content-length'], undefined);
	assert.equal(response['content-type'], 'application/json');
});
