const RETRYABLE_STATUS = new Set([408, 425, 429]);
const RETRYABLE_CODES = new Set(['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']);

function isRetryable(error) {
  const status = error?.response?.status ?? error?.status;
  return (
    RETRYABLE_CODES.has(error?.code) ||
    error?.name === 'AbortError' ||
    RETRYABLE_STATUS.has(status) ||
    status >= 500
  );
}

async function retryAsync(operation, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}

module.exports = { retryAsync };
