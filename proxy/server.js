import http from 'node:http';

const port = Number(process.env.BYMAGA_PROXY_PORT || 8080);
const upstream = (process.env.BYMAGA_UPSTREAM_URL || 'https://f456.fly.dev/v1').replace(/\/$/, '');
const apiKey = process.env.BYMAGA_API_KEY;
const requestTimeout = Number(process.env.BYMAGA_PROXY_TIMEOUT_MS || 180000);

export { responseHeaders, toResponsesInput, toResponsesTools, toResponsesToolChoice, toChatCompletion, toChatStream };

function responseHeaders(headers) {
	const result = new Headers(headers);
	result.delete('content-encoding');
	result.delete('content-length');
	return Object.fromEntries(result);
}

function stripImageDetail(value) {
	if (Array.isArray(value)) return value.map(stripImageDetail);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value).map(([key, child]) => [
		key,
		key === 'image_url' && child && typeof child === 'object' && !Array.isArray(child)
			? Object.fromEntries(Object.entries(child)
				.filter(([childKey]) => childKey !== 'detail')
				.map(([childKey, childValue]) => [childKey, stripImageDetail(childValue)]))
			: stripImageDetail(child),
	]));
}

function toResponsesInput(messages = []) {
	return messages.flatMap((message) => {
		if (message.role === 'tool') {
			return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
		}
		if (message.role === 'assistant' && message.tool_calls?.length) {
			return message.tool_calls.map(({ id, function: call }) => ({
				type: 'function_call',
				call_id: id,
				name: call.name,
				arguments: call.arguments,
			}));
		}
		return [{
		role: message.role,
		content: typeof message.content === 'string'
			? [{ type: 'input_text', text: message.content }]
			: (message.content || []).map((part) => {
				if (part.type === 'text') return { type: 'input_text', text: part.text };
				if (part.type === 'image_url') {
					const image = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
					return { type: 'input_image', image_url: image };
				}
				return part;
			}),
		}];
	});
}

function toResponsesTools(tools = []) {
	return tools.map((tool) => tool.type === 'function' && tool.function
		? { type: 'function', ...tool.function }
		: tool);
}

function toResponsesToolChoice(toolChoice) {
	if (!toolChoice || typeof toolChoice !== 'object' || !toolChoice.function) return toolChoice;
	return { type: 'function', name: toolChoice.function.name };
}

function toChatCompletion(result) {
	const text = (result.output || [])
		.flatMap((item) => item.content || [])
		.filter((part) => part.type === 'output_text')
		.map((part) => part.text || '')
		.join('');
	return {
		id: result.id,
		object: 'chat.completion',
		created: result.created_at,
		model: result.model,
		choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
		usage: result.usage,
	};
}

function toChatStream(result) {
	if (result.type === 'response.output_text.delta') {
		return {
			id: result.response?.id,
			object: 'chat.completion.chunk',
			created: result.response?.created_at,
			model: result.response?.model,
			choices: [{ index: 0, delta: { role: 'assistant', content: result.delta }, finish_reason: null }],
		};
	}
	if (result.type === 'response.output_item.added' && result.item?.type === 'function_call') {
		return {
			id: result.item.call_id,
			object: 'chat.completion.chunk',
			choices: [{ index: 0, delta: { tool_calls: [{ index: result.output_index, id: result.item.call_id, type: 'function', function: { name: result.item.name, arguments: '' } }] }, finish_reason: null }],
		};
	}
	if (result.type === 'response.function_call_arguments.delta') {
		return {
			object: 'chat.completion.chunk',
			choices: [{ index: 0, delta: { tool_calls: [{ index: result.output_index, function: { arguments: result.delta } }] }, finish_reason: null }],
		};
	}
	return null;
}

function readBody(request) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		request.on('data', (chunk) => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks)));
		request.on('error', reject);
	});
}

export const server = http.createServer(async (request, response) => {
	let abortController;
	let abortRequest;
	let timeout;

	try {
		if (request.method === 'GET' && request.url === '/health') {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ status: 'ok' }));
			return;
		}

		const body = await readBody(request);
		const headers = new Headers(request.headers);
		headers.delete('host');
		headers.delete('content-length');
		headers.delete('content-encoding');
		if (apiKey) headers.set('authorization', `Bearer ${apiKey}`);

		let requestBody = body;
		let convertResponse = false;
		let streamResponse = false;
		if (request.method === 'POST' && request.url?.startsWith('/v1/chat/completions')) {
			convertResponse = true;
			try {
				const chatRequest = stripImageDetail(JSON.parse(body));
				const responsesRequest = {
					model: chatRequest.model,
					input: toResponsesInput(chatRequest.messages),
					stream: Boolean(chatRequest.stream),
				};
				streamResponse = responsesRequest.stream;
				for (const key of ['temperature', 'top_p', 'max_output_tokens', 'tools', 'tool_choice']) {
					if (chatRequest[key] !== undefined) responsesRequest[key] = chatRequest[key];
				}
				if (responsesRequest.tools) responsesRequest.tools = toResponsesTools(responsesRequest.tools);
				responsesRequest.tool_choice = toResponsesToolChoice(responsesRequest.tool_choice);
				requestBody = Buffer.from(JSON.stringify(responsesRequest));
				request.url = request.url.replace('/chat/completions', '/responses');
				headers.set('content-type', 'application/json');
			} catch {
				response.writeHead(400, { 'content-type': 'application/json' });
				response.end(JSON.stringify({ error: { message: 'Request body must be valid JSON' } }));
				return;
			}
		}

		abortController = new AbortController();
		abortRequest = () => abortController.abort();
		request.once('aborted', abortRequest);
		response.once('close', abortRequest);
		timeout = setTimeout(() => abortController.abort(), requestTimeout);
		const upstreamResponse = await fetch(`${upstream}${request.url?.replace(/^\/v1/, '') || ''}`, {
			method: request.method,
			headers,
			body: ['GET', 'HEAD'].includes(request.method) ? undefined : requestBody,
			signal: abortController.signal,
		});
		if (response.destroyed) return;
		if (convertResponse && !streamResponse) {
			const result = await upstreamResponse.json();
			response.writeHead(upstreamResponse.status, { 'content-type': 'application/json' });
			response.end(JSON.stringify(upstreamResponse.ok ? toChatCompletion(result) : result));
			return;
		}
		if (convertResponse) {
			response.writeHead(upstreamResponse.status, {
				'content-type': 'text/event-stream',
				'cache-control': 'no-cache',
				'connection': 'keep-alive',
			});
			if (upstreamResponse.body) {
				const reader = upstreamResponse.body.pipeThrough(new TextDecoderStream()).getReader();
				let buffer = '';
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buffer += value;
					const events = buffer.split('\n\n');
					buffer = events.pop() || '';
					for (const event of events) {
						const data = event.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim();
						if (!data || data === '[DONE]') continue;
						try {
							const chunk = toChatStream(JSON.parse(data));
							if (chunk && !response.destroyed) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
						} catch {}
					}
				}
			}
			if (!response.destroyed) {
				response.write('data: [DONE]\n\n');
				response.end();
			}
			return;
		}
		response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers));
		if (upstreamResponse.body) {
			for await (const chunk of upstreamResponse.body) response.write(chunk);
		}
		response.end();
	} catch (error) {
		if (!response.headersSent && !response.destroyed) {
			response.writeHead(abortController?.signal.aborted ? 504 : 502, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ error: { message: error.message } }));
		}
	} finally {
		if (timeout) clearTimeout(timeout);
		if (abortRequest) {
			request.off('aborted', abortRequest);
			response.off('close', abortRequest);
		}
	}
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
	server.listen(port, '0.0.0.0', () => console.log(`bymaga proxy daemon listening on ${port}`));
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.once(signal, () => server.close(() => process.exit(0)));
	}
}
