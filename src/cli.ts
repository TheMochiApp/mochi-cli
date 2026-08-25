#!/usr/bin/env node

import { runCli } from "./main.js";

void runCli().catch(() => {
  process.stdout.write(
    '{"ok":false,"error":{"code":"UNEXPECTED","message":"The Mochi CLI encountered an unexpected error."}}\n',
  );
  process.exitCode = 7;
});
