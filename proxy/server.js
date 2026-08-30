import http from 'node:http';

const port = Number(process.env.BYMAGA_PROXY_PORT || 8080);
const upstream = (process.env.BYMAGA_UPSTREAM_URL || 'https://f456.fly.dev/v1').replace(/\/$/, '');
const apiKey = process.env.BYMAGA_API_KEY;
const requestTimeout = Number(process.env.BYMAGA_PROXY_TIMEOUT_MS || 180000);

export { responseHeaders, stripImageDetail };

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
	const startedAt = Date.now();
	const logRequest = (status) => console.log(`[proxy] ${request.method} ${request.url} ${status} ${Date.now() - startedAt}ms`);

	try {
		if (request.method === 'GET' && request.url === '/health') {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ status: 'ok' }));
			logRequest(200);
			return;
		}

		const body = await readBody(request);
		const headers = new Headers(request.headers);
		headers.delete('host');
		headers.delete('content-length');
		headers.delete('content-encoding');
		if (apiKey) headers.set('authorization', `Bearer ${apiKey}`);

		let requestBody = body;
		if (request.method === 'POST' && request.url?.startsWith('/v1/chat/completions')) {
			try {
				requestBody = Buffer.from(JSON.stringify(stripImageDetail(JSON.parse(body))));
				headers.set('content-type', 'application/json');
			} catch {
				response.writeHead(400, { 'content-type': 'application/json' });
				response.end(JSON.stringify({ error: { message: 'Request body must be valid JSON' } }));
				logRequest(400);
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
		response.writeHead(upstreamResponse.status, responseHeaders(upstreamResponse.headers));
		if (upstreamResponse.body) {
			for await (const chunk of upstreamResponse.body) response.write(chunk);
		}
		response.end();
		logRequest(upstreamResponse.status);
	} catch (error) {
		if (!response.headersSent && !response.destroyed) {
			response.writeHead(abortController?.signal.aborted ? 504 : 502, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ error: { message: error.message } }));
			logRequest(abortController?.signal.aborted ? 504 : 502);
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
