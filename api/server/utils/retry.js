const RETRYABLE_STATUS = new Set([408, 425, 429]);

function isRetryable(error) {
  const status = error?.response?.status ?? error?.status;
  return status == null || RETRYABLE_STATUS.has(status) || status >= 500;
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
