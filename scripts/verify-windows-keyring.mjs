import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";

if (process.platform !== "win32") {
  process.stderr.write("The Windows Credential Manager gate must run on Windows.\n");
  process.exit(1);
}

const service = `app.themochi.cli.ci.${randomUUID()}`;
const account = `ephemeral-${randomUUID()}`;
const password = randomBytes(32).toString("base64url");
let entry;
let failure;

try {
  const keyring = await import("@napi-rs/keyring");
  entry = new keyring.Entry(service, account);
  entry.setPassword(password);
  if (entry.getPassword() !== password) failure = "Windows Credential Manager did not round-trip the test value.";
} catch {
  failure = "The native Windows keyring or Credential Manager is unavailable.";
} finally {
  if (entry) {
    try {
      if (!entry.deleteCredential() && !failure) failure = "Windows Credential Manager cleanup failed.";
    } catch {
      failure ??= "Windows Credential Manager cleanup failed.";
    }
  }
}

if (failure) {
  process.stderr.write(`${failure}\n`);
  process.exit(1);
}
process.stdout.write("Verified an isolated Windows Credential Manager round trip.\n");
