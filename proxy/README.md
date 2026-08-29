# bymaga proxy

This is a standalone daemon container. It removes the unsupported
`image_url.detail` field from LibreChat Chat Completions vision requests.
Other `/v1/*` requests, including streaming responses, are forwarded unchanged.

Set the bymaga endpoint in `librechat.yaml` to the Docker service URL:

```yaml
endpoints:
  custom:
    - name: bymaga
      baseURL: 'http://bymaga-proxy:8080/v1'
```

The proxy uses `BYMAGA_UPSTREAM_URL` and optionally `BYMAGA_API_KEY` from `.env`.
It listens on `/health` and shuts down gracefully on `SIGTERM`/`SIGINT`.
