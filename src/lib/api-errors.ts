/**
 * API Error handling utilities for Edge Functions and fetch requests
 */

export type ApiErrorType =
  | "cors"
  | "network"
  | "timeout"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limit"
  | "server_error"
  | "unknown";

export interface ApiError {
  type: ApiErrorType;
  message: string;
  statusCode?: number;
  originalError?: Error;
  retryable: boolean;
}

const ERROR_MESSAGES: Record<ApiErrorType, string> = {
  cors: "Unable to connect to the server due to a CORS policy restriction. Please contact support.",
  network: "Network connection failed. Please check your internet connection and try again.",
  timeout: "The request timed out. Please try again.",
  unauthorized: "Your session has expired. Please log in again.",
  forbidden: "You don't have permission to access this resource.",
  not_found: "The requested resource was not found.",
  rate_limit: "Too many requests. Please wait a moment and try again.",
  server_error: "An unexpected server error occurred. Please try again later.",
  unknown: "An unexpected error occurred. Please try again.",
};

/**
 * Determines the type of API error from a fetch response or error
 */
export function classifyApiError(error: unknown, response?: Response): ApiError {
  // Handle CORS errors (typically manifest as TypeError with "Failed to fetch")
  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();

    if (message.includes("failed to fetch") || message.includes("cors") || message.includes("network")) {
      // CORS errors and network errors both show as "Failed to fetch"
      // We can't distinguish them perfectly, but we can provide helpful guidance
      return {
        type: "cors",
        message: ERROR_MESSAGES.cors,
        originalError: error,
        retryable: false,
      };
    }
  }

  // Handle FunctionsFetchError from Supabase SDK
  if (error instanceof Error && error.name === "FunctionsFetchError") {
    const message = error.message.toLowerCase();

    if (message.includes("cors")) {
      return {
        type: "cors",
        message: ERROR_MESSAGES.cors,
        originalError: error,
        retryable: false,
      };
    }

    if (message.includes("failed to send")) {
      return {
        type: "network",
        message: "Failed to reach the Edge Function. The function may not be deployed or is unreachable.",
        originalError: error,
        retryable: true,
      };
    }
  }

  // Handle timeout errors
  if (error instanceof Error && error.name === "AbortError") {
    return {
      type: "timeout",
      message: ERROR_MESSAGES.timeout,
      originalError: error,
      retryable: true,
    };
  }

  // Handle HTTP response errors
  if (response && !response.ok) {
    const statusCode = response.status;

    if (statusCode === 401) {
      return {
        type: "unauthorized",
        message: ERROR_MESSAGES.unauthorized,
        statusCode,
        retryable: false,
      };
    }

    if (statusCode === 403) {
      return {
        type: "forbidden",
        message: ERROR_MESSAGES.forbidden,
        statusCode,
        retryable: false,
      };
    }

    if (statusCode === 404) {
      return {
        type: "not_found",
        message: ERROR_MESSAGES.not_found,
        statusCode,
        retryable: false,
      };
    }

    if (statusCode === 429) {
      return {
        type: "rate_limit",
        message: ERROR_MESSAGES.rate_limit,
        statusCode,
        retryable: true,
      };
    }

    if (statusCode >= 500) {
      return {
        type: "server_error",
        message: ERROR_MESSAGES.server_error,
        statusCode,
        retryable: true,
      };
    }
  }

  // Generic error fallback
  return {
    type: "unknown",
    message: error instanceof Error ? error.message : ERROR_MESSAGES.unknown,
    originalError: error instanceof Error ? error : undefined,
    retryable: true,
  };
}

/**
 * Creates a user-friendly error message based on the error type
 */
export function getErrorMessage(apiError: ApiError): string {
  return apiError.message;
}

/**
 * Determines if an error should trigger a retry
 */
export function shouldRetry(apiError: ApiError, attemptCount: number, maxAttempts = 3): boolean {
  return apiError.retryable && attemptCount < maxAttempts;
}

/**
 * Wrapper for fetch that includes error classification
 */
export async function fetchWithErrorHandling<T>(
  url: string,
  options?: RequestInit & { timeout?: number }
): Promise<{ data: T | null; error: ApiError | null }> {
  const { timeout = 30000, ...fetchOptions } = options || {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = classifyApiError(new Error(`HTTP ${response.status}`), response);
      return { data: null, error };
    }

    const data = await response.json();
    return { data, error: null };
  } catch (err) {
    clearTimeout(timeoutId);
    const error = classifyApiError(err);
    return { data: null, error };
  }
}