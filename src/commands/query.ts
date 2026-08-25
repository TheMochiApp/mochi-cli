import { CliError, ExitCode } from "../core/errors.js";

export function parseQueryPairs(pairs: readonly string[]): URLSearchParams {
  const parameters = new URLSearchParams();
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    const key = separator === -1 ? "" : pair.slice(0, separator);
    const value = separator === -1 ? "" : pair.slice(separator + 1);
    if (
      separator === -1 ||
      key.length === 0 ||
      hasControlCharacter(key) ||
      hasControlCharacter(value) ||
      key === "prototype" ||
      Object.hasOwn(Object.prototype, key)
    ) {
      throw new CliError("INVALID_QUERY", "Query values must use a safe non-empty key=value form.", ExitCode.Usage);
    }
    parameters.append(key, value);
  }
  return parameters;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
