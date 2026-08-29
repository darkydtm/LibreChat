# bymaga proxy

This is a standalone daemon container. It converts LibreChat Chat Completions
vision requests to bymaga Responses API requests and converts non-streaming
Responses back to Chat Completions. Other `/v1/*` requests are forwarded.

Set the bymaga endpoint in `librechat.yaml` to the Docker service URL:

```yaml
endpoints:
  custom:
    - name: bymaga
      baseURL: 'http://bymaga-proxy:8080/v1'
```

The proxy uses `BYMAGA_UPSTREAM_URL` and optionally `BYMAGA_API_KEY` from `.env`.
It listens on `/health` and shuts down gracefully on `SIGTERM`/`SIGINT`.
