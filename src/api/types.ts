export interface ApiResponse {
  status: number;
  body: unknown;
  requestId?: string;
  retryAfter?: string;
}
