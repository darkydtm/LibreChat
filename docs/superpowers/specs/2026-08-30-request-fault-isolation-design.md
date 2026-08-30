# Request Fault Isolation

## Goal

Ensure one failed request or background job does not crash the process, block unrelated work, or leave shared state unusable. The first iteration covers request isolation, cancellation, bounded retries, and queue continuation. Circuit breakers and provider failover are out of scope.

## Architecture

Use existing request and queue execution boundaries rather than introducing a new application-wide framework.

- HTTP handlers must convert failures into a response for the current request only.
- Every request with an external operation must have a bounded timeout and an abort signal.
- Streaming handlers must abort upstream work when the client disconnects and must not write to a closed response.
- Each background job must run inside its own error boundary and release queue resources in `finally`.
- Retry handling belongs at the external-operation or job boundary, not in every caller.

## Retry Policy

Retry only transient failures: network errors, timeout, `408`, `425`, `429`, and `5xx` responses. Use a bounded exponential backoff with a small maximum attempt count. Do not retry validation errors, other `4xx` responses, or non-idempotent operations unless the operation already has an idempotency key.

When retries are exhausted, return the final request error or mark the job failed/dead-lettered. Do not retry indefinitely and do not terminate the process.

## Shared State

Request-specific error state must be cleared or finalized for that request. A failed message must not mark the entire client store or shared queue as unavailable. Queue slots, locks, timers, and abort listeners must be released on success, failure, timeout, and disconnect.

## Tests and Acceptance Criteria

- A failed upstream request returns an error only to its caller while a concurrent successful request completes.
- A hung upstream is cancelled at the timeout and does not consume resources indefinitely.
- Disconnecting during streaming cancels upstream work without an unhandled rejection.
- A failed background job does not stop the next job from executing.
- Transient failures retry within the configured bound; permanent failures do not retry.
- Exhausted jobs have a terminal failure state and are not silently lost.

## Scope Boundary

Implement the smallest changes at the shared execution boundaries discovered during implementation. Do not add a circuit breaker, provider failover, new dependency, or unrelated refactoring in this iteration.
