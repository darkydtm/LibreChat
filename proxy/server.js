import http from 'node:http';

const port = Number(process.env.BYMAGA_PROXY_PORT || 8080);
const upstream = (process.env.BYMAGA_UPSTREAM_URL || 'https://f456.fly.dev/v1').replace(/\/$/, '');
const apiKey = process.env.BYMAGA_API_KEY;
const requestTimeout = Number(process.env.BYMAGA_PROXY_TIMEOUT_MS || 180000);

export { responseHeaders, toResponsesInput, toChatCompletion };

function responseHeaders(headers) {
	const result = new Headers(headers);
	result.delete('content-encoding');
	result.delete('content-length');
	return Object.fromEntries(result);
}

function toResponsesInput(messages = []) {
	return messages.map((message) => ({
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
	}));
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

function readBody(request) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		request.on('data', (chunk) => chunks.push(chunk));
		request.on('end', () => resolve(Buffer.concat(chunks)));
		request.on('error', reject);
	});
}

export const server = http.createServer(async (request, response) => {
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
		if (request.method === 'POST' && request.url?.startsWith('/v1/chat/completions')) {
			convertResponse = true;
			try {
				const chatRequest = JSON.parse(body);
				const responsesRequest = {
					model: chatRequest.model,
					input: toResponsesInput(chatRequest.messages),
					stream: Boolean(chatRequest.stream),
				};
				for (const key of ['temperature', 'top_p', 'max_output_tokens', 'tools', 'tool_choice']) {
					if (chatRequest[key] !== undefined) responsesRequest[key] = chatRequest[key];
				}
				requestBody = Buffer.from(JSON.stringify(responsesRequest));
				request.url = request.url.replace('/chat/completions', '/responses');
				headers.set('content-type', 'application/json');
			} catch {
				response.writeHead(400, { 'content-type': 'application/json' });
				response.end(JSON.stringify({ error: { message: 'Request body must be valid JSON' } }));
				return;
			}
		}

		const abortController = new AbortController();
		const timeout = setTimeout(() => abortController.abort(), requestTimeout);
		let upstreamResponse;
		try {
			upstreamResponse = await fetch(`${upstream}${request.url?.replace(/^\/v1/, '') || ''}`, {
				method: request.method,
				headers,
				body: ['GET', 'HEAD'].includes(request.method) ? undefined : requestBody,
				signal: abortController.signal,
			});
		} finally {
			clearTimeout(timeout);
		}
		if (convertResponse && !requestBody.includes(Buffer.from('"stream":true'))) {
			const result = await upstreamResponse.json();
			response.writeHead(upstreamResponse.status, { 'content-type': 'application/json' });
			response.end(JSON.stringify(upstreamResponse.ok ? toChatCompletion(result) : result));
			return;
		}
		response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers));
		if (upstreamResponse.body) {
			for await (const chunk of upstreamResponse.body) response.write(chunk);
		}
		response.end();
	} catch (error) {
		response.writeHead(502, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ error: { message: error.message } }));
	}
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
	server.listen(port, '0.0.0.0', () => console.log(`bymaga proxy daemon listening on ${port}`));
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.once(signal, () => server.close(() => process.exit(0)));
	}
}
