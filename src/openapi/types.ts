export interface OpenApiInfo {
  version: string;
  [key: string]: unknown;
}

export interface OpenApiOperation {
  operationId?: unknown;
  "x-mochi-required-scope"?: unknown;
  [key: string]: unknown;
}

export interface OpenApiPathItem {
  get?: OpenApiOperation;
  [key: string]: unknown;
}

export interface OpenApiDocument {
  openapi: string;
  info: OpenApiInfo;
  paths: Record<string, OpenApiPathItem>;
  [key: string]: unknown;
}
