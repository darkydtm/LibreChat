# bymaga proxy

This proxy removes the unsupported `image_url.detail` field from LibreChat
vision requests before forwarding them to bymaga. Other `/v1/*` requests are
forwarded unchanged, including streaming responses.

Set the bymaga endpoint in `librechat.yaml` to the Docker service URL:

```yaml
endpoints:
  custom:
    - name: bymaga
      baseURL: 'http://bymaga-proxy:8080/v1'
```

The proxy uses `BYMAGA_UPSTREAM_URL` and optionally `BYMAGA_API_KEY` from `.env`.
