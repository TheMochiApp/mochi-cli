import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  external: ["@napi-rs/keyring"],
  clean: true,
  dts: false,
  shims: true,
});
