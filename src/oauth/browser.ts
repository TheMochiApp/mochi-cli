import { spawn as nodeSpawn } from "node:child_process";

export interface BrowserProcess {
  unref(): void;
  once(event: "error" | "close", listener: (value: Error | number | null) => void): BrowserProcess;
}

export type BrowserSpawn = (
  command: string,
  args: readonly string[],
  options: { stdio: "ignore"; windowsHide: true },
) => BrowserProcess;

export interface OpenBrowserOptions {
  platform?: NodeJS.Platform;
  spawn?: BrowserSpawn;
}

export async function openBrowser(authorizationUrl: string, options: OpenBrowserOptions = {}): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const spawn = options.spawn ?? (nodeSpawn as unknown as BrowserSpawn);
  const invocation = browserInvocation(platform, authorizationUrl);
  if (!invocation) return authorizationUrl;

  return await new Promise<string | null>((resolve) => {
    let finished = false;
    const finish = (result: string | null) => {
      if (!finished) {
        finished = true;
        resolve(result);
      }
    };
    try {
      const child = spawn(invocation.command, invocation.args, { stdio: "ignore", windowsHide: true });
      child.once("error", () => finish(authorizationUrl));
      child.once("close", (code) => finish(code === 0 ? null : authorizationUrl));
      child.unref();
    } catch {
      finish(authorizationUrl);
    }
  });
}

function browserInvocation(
  platform: NodeJS.Platform,
  authorizationUrl: string,
): { command: string; args: readonly string[] } | null {
  if (platform === "darwin") return { command: "open", args: [authorizationUrl] };
  if (platform === "win32") {
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", authorizationUrl] };
  }
  if (platform === "linux") return { command: "xdg-open", args: [authorizationUrl] };
  return null;
}
