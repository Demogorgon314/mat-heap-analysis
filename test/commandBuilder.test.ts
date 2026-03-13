import assert from "node:assert/strict";
import test from "node:test";
import { buildGenericCommand, buildOqlCommand, buildParseReportCommand, formatOqlForMatCommand } from "../src/core/commandBuilder.js";

const base = {
  javaPath: "java",
  launcherPath: "/mat/launcher.jar",
  heapPath: "/heaps/a.hprof",
  configDir: "/tmp/mat-config",
  dataDir: "/tmp/mat-workspace",
  xmxMb: 4096,
  timeoutSec: 600
};

test("buildParseReportCommand includes options and report id", () => {
  const cmd = buildParseReportCommand(base, "org.eclipse.mat.api:suspects", {
    format: "txt",
    limit: 100
  });

  assert.equal(cmd.command, "java");
  assert.equal(cmd.timeoutSec, 600);
  assert.equal(cmd.args.at(-1), "org.eclipse.mat.api:suspects");
  assert.ok(cmd.args.includes("-Djava.awt.headless=true"));
  assert.ok(cmd.args.includes("-format=txt"));
  assert.ok(cmd.args.includes("-limit=100"));
});

test("buildOqlCommand encodes command and output flags", () => {
  const cmd = buildOqlCommand(base, {
    oql: "select * from java.lang.String",
    format: "txt",
    unzip: true,
    limit: 10
  });

  assert.equal(cmd.args.at(-1), "org.eclipse.mat.api:query");
  assert.ok(cmd.args.includes("-format=txt"));
  assert.ok(cmd.args.includes("-unzip"));
  assert.ok(cmd.args.includes("-limit=10"));
  assert.ok(cmd.args.includes('-command=oql "select * from java.lang.String"'));
});

test("formatOqlForMatCommand escapes nested quotes", () => {
  const formatted = formatOqlForMatCommand('SELECT p FROM INSTANCEOF "com.example.MyClass" p');
  assert.equal(formatted, '"SELECT p FROM INSTANCEOF \\"com.example.MyClass\\" p"');
});

test("buildGenericCommand with command args", () => {
  const cmd = buildGenericCommand(base, {
    commandName: "path2gc",
    commandArgs: "0x12345678",
    format: "html",
    unzip: false,
    limit: 50
  });

  assert.ok(cmd.args.includes("-command=path2gc 0x12345678"));
  assert.ok(cmd.args.includes("-format=html"));
  assert.ok(cmd.args.includes("-limit=50"));
  assert.ok(!cmd.args.includes("-unzip"));
});
