import { MatCliError, type MatOqlSpecSuccess } from "../types.js";

export const MAT_OQL_SPEC: Omit<MatOqlSpecSuccess, "status"> = {
  parser_mode: "Eclipse MAT parse-application OQL command mode",
  command_format: "-command=oql \"<query>\"",
  client_input_rules: [
    "Client may send OQL with or without outer quotes.",
    "CLI normalizes and wraps the query for MAT command mode.",
    "Use simple MAT OQL forms over SQL-style clauses."
  ],
  supported_patterns: [
    {
      name: "Instance scan",
      query: "SELECT p FROM INSTANCEOF com.example.MyClass p",
      description: "Iterate objects by class and inspect fields in follow-up queries."
    },
    {
      name: "Object field extraction",
      query: "SELECT p.topic FROM OBJECTS 0x12345678 p",
      description: "Read fields from one specific object address."
    },
    {
      name: "Boolean/state check",
      query: "SELECT p.isClosingOrDeleting FROM OBJECTS 0x12345678 p",
      description: "Validate lifecycle flags for a specific object."
    },
    {
      name: "Class histogram route",
      query: "Use report org.eclipse.mat.api:overview and parse Class_Histogram*.txt",
      description: "Preferred way to rank classes in this parser mode."
    }
  ],
  unsupported_patterns: [
    "SQL-like GROUP BY/ORDER BY forms frequently fail in parse-app query mode.",
    "Dialect-specific helpers like classof(...) may be rejected depending on parser context."
  ],
  notes: [
    "For ranking/top classes, prefer MAT overview/suspects reports then parse artifacts.",
    "For root-cause inspection, use targeted field-level OQL against object addresses."
  ]
};

export function normalizeOqlInput(oql: string): string {
  const trimmed = oql.trim();
  if (trimmed.length === 0) {
    throw new MatCliError({
      category: "INVALID_QUERY",
      message: "OQL query is empty.",
      hint: "Provide a non-empty OQL query string."
    });
  }

  const isWrappedDouble = trimmed.startsWith("\"") && trimmed.endsWith("\"");
  const isWrappedSingle = trimmed.startsWith("'") && trimmed.endsWith("'");
  if ((isWrappedDouble || isWrappedSingle) && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) {
      throw new MatCliError({
        category: "INVALID_QUERY",
        message: "OQL query is empty after removing wrapping quotes.",
        hint: "Provide a non-empty OQL query string."
      });
    }
    return inner;
  }

  return trimmed;
}
