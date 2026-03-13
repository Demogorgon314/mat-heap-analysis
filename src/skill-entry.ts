import { runCli } from "./cli/program.js";

void runCli(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
