export interface OAuthMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string;
}

export interface OAuthHttpResponse {
  status: number;
  body: unknown;
  headers?: Readonly<Record<string, string>>;
}

export interface OAuthHttp {
  getJson(url: string): Promise<OAuthHttpResponse>;
  postJson(url: string, body: Readonly<Record<string, unknown>>): Promise<OAuthHttpResponse>;
  postForm(url: string, body: URLSearchParams): Promise<OAuthHttpResponse>;
}

export interface OAuthCallback {
  code: string;
  redirectUri: string;
}
