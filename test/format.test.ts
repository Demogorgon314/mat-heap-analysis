import assert from "node:assert/strict";
import test from "node:test";
import { formatHumanResponse, type OverflowStore } from "../src/cli/format.js";
import type { MatOqlQuerySuccess } from "../src/types.js";

test("formatHumanResponse spills large outputs to overflow storage", () => {
  let stored = "";
  const overflowStore: OverflowStore = {
    write(text: string) {
      stored = text;
      return "/tmp/mat-cli-output/cmd-1.txt";
    }
  };

  const response: MatOqlQuerySuccess = {
    status: "ok",
    exit_code: 0,
    query_dir: "/tmp/query",
    query_zip: "/tmp/query.zip",
    result_txt: "/tmp/query/pages/Query_Command1.txt",
    result_preview: Array.from({ length: 250 }, (_, index) => `line ${index + 1}`),
    generated_files: ["/tmp/query.zip"],
    stdout_tail: "",
    stderr_tail: ""
  };

  const output = formatHumanResponse("query", response, 25, 0, overflowStore);
  assert.match(output, /output truncated/);
  assert.match(output, /Full output: \/tmp\/mat-cli-output\/cmd-1.txt/);
  assert.ok(stored.includes("line 250"));
});
