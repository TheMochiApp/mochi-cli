import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";

export type RandomBytes = (length: number) => Uint8Array;

export interface PkceValues {
  verifier: string;
  challenge: string;
  state: string;
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function createPkce(randomBytes: RandomBytes = nodeRandomBytes): PkceValues {
  const verifier = Buffer.from(randomBytes(64)).toString("base64url");
  const state = Buffer.from(randomBytes(32)).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier), state };
}
