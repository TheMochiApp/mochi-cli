export const DOCS_INDEX_URL: string;
export const OPENAPI_URL: string;

export interface DiscoveryLinks {
  guideUrls: string[];
  openapiUrl: string;
}

export interface LiveDocsResult {
  guideCount: number;
  openapiVersion: string;
}

export function parseDiscoveryLinks(content: string, indexUrl?: string): DiscoveryLinks;
export function checkLiveDocs(options?: { fetchImpl?: typeof fetch }): Promise<LiveDocsResult>;
