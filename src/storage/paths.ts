import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { CliError, ExitCode } from "../core/errors.js";

export interface StoragePaths {
  configDirectory: string;
  credentialsPath: string;
  clientPath: string;
  /** Fixed directory path used by the atomic credential lease protocol. */
  lockPath: string;
}

export interface StoragePathOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  allowWindowsOverrideForTests?: boolean;
}

export function resolveStoragePaths(options: StoragePathOptions = {}): StoragePaths {
  const environment = options.environment ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const configuredDirectory = environment.MOCHI_CONFIG_DIR;
  if (platform === "win32" && configuredDirectory && !options.allowWindowsOverrideForTests) {
    throw new CliError(
      "CONFIG_INVALID",
      "MOCHI_CONFIG_DIR is not accepted on Windows because its ACLs cannot be verified.",
      ExitCode.Local,
    );
  }
  const configDirectory = configuredDirectory
    ? requireAbsolute(configuredDirectory)
    : defaultConfigDirectory(platform, homeDirectory, environment);

  return {
    configDirectory,
    credentialsPath: join(configDirectory, "credentials.json"),
    clientPath: join(configDirectory, "oauth-client.json"),
    lockPath: join(configDirectory, "credentials.lock"),
  };
}

function defaultConfigDirectory(
  platform: NodeJS.Platform,
  homeDirectory: string,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  if (platform === "darwin") {
    return join(homeDirectory, "Library", "Application Support", "mochi");
  }
  if (platform === "win32") {
    const localAppData = environment.LOCALAPPDATA;
    return localAppData && isAbsolute(localAppData)
      ? join(localAppData, "Mochi")
      : join(homeDirectory, "AppData", "Local", "Mochi");
  }
  const xdgConfigHome = environment.XDG_CONFIG_HOME;
  return xdgConfigHome && isAbsolute(xdgConfigHome)
    ? join(xdgConfigHome, "mochi")
    : join(homeDirectory, ".config", "mochi");
}

function requireAbsolute(value: string): string {
  if (!isAbsolute(value)) {
    throw new CliError("CONFIG_INVALID", "MOCHI_CONFIG_DIR must be an absolute path.", ExitCode.Local);
  }
  return value;
}
