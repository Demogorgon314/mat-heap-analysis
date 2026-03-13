import type {
  CatalogCommandEntry,
  CatalogErrorEntry,
  CatalogSection,
  CatalogSuccess,
  CatalogReportEntry
} from "./types.js";
import { MAT_OQL_SPEC } from "./core/oqlSpec.js";

export const ALLOWED_REPORT_IDS = [
  "org.eclipse.mat.api:suspects",
  "org.eclipse.mat.api:overview",
  "org.eclipse.mat.api:top_components",
  "org.eclipse.mat.api:compare",
  "org.eclipse.mat.api:suspects2",
  "org.eclipse.mat.api:overview2"
] as const;

export const ALLOWED_COMMANDS = [
  "dominator_tree",
  "show_dominator_tree",
  "immediate_dominators",
  "big_drops_in_dominator_tree",
  "path2gc",
  "merge_shortest_paths",
  "gc_roots",
  "histogram",
  "delta_histogram",
  "list_objects",
  "group_by_value",
  "duplicate_classes",
  "leakhunter",
  "leakhunter2",
  "find_leaks",
  "find_leaks2",
  "reference_leak",
  "thread_overview",
  "thread_details",
  "thread_stack",
  "collection_fill_ratio",
  "collections_grouped_by_size",
  "array_fill_ratio",
  "arrays_grouped_by_size",
  "hash_entries",
  "map_collision_ratio",
  "extract_list_values",
  "hash_set_values",
  "primitive_arrays_with_a_constant_value",
  "references_statistics",
  "weak_references_statistics",
  "soft_references_statistics",
  "phantom_references_statistics",
  "finalizer_references_statistics",
  "finalizer_overview",
  "finalizer_thread",
  "finalizer_queue",
  "finalizer_in_processing",
  "finalizer_thread_locals",
  "show_retained_set",
  "customized_retained_set",
  "component_report",
  "component_report_top",
  "top_consumers",
  "top_consumers_html",
  "pie_biggest_objects",
  "find_strings",
  "waste_in_char_arrays",
  "heap_dump_overview",
  "unreachable_objects",
  "system_properties",
  "class_references",
  "comparison_report",
  "bundle_registry",
  "leaking_bundles",
  "export_hprof"
] as const;

export const CLI_COMMANDS: CatalogCommandEntry[] = [
  {
    name: "doctor",
    summary: "Validate MAT launcher and Java runtime.",
    usage: "mat doctor [--mat-home <dir>] [--mat-launcher <jar>] [--java-path <bin>] [--json]",
    examples: [
      "mat doctor",
      "mat doctor --mat-home /opt/mat",
      "mat doctor --mat-launcher /opt/mat/plugins/org.eclipse.equinox.launcher_*.jar"
    ],
    related: ["catalog", "report", "query"]
  },
  {
    name: "report",
    summary: "Run a predefined MAT report and return generated artifacts.",
    usage:
      "mat report <report-id> --heap <path> [--option key=value ...] [--allowed-root <dir>] [--json]",
    examples: [
      "mat report org.eclipse.mat.api:suspects --heap ./heap.hprof",
      "mat report org.eclipse.mat.api:compare --heap ./new.hprof --option baseline=../baseline/old.hprof --allowed-root . --allowed-root ../baseline"
    ],
    related: ["catalog reports", "query", "run", "index"]
  },
  {
    name: "query",
    summary: "Execute a single MAT OQL query and preview result artifacts.",
    usage:
      "mat query --heap <path> (--query <oql> | --query-file <file>) [--format txt|html|csv] [--unzip] [--allowed-root <dir>] [--json]",
    examples: [
      "mat query --heap ./heap.hprof --query 'SELECT s FROM INSTANCEOF java.lang.String s'",
      "mat query --heap ./heap.hprof --query-file ./query.oql"
    ],
    related: ["catalog oql", "run", "report"]
  },
  {
    name: "run",
    summary: "Execute a named MAT analysis command.",
    usage:
      "mat run <command-name> --heap <path> [--args <text>] [--format txt|html|csv] [--unzip] [--allowed-root <dir>] [--json]",
    examples: [
      "mat run histogram --heap ./heap.hprof",
      "mat run path2gc --heap ./heap.hprof --args 0x12345678"
    ],
    related: ["catalog commands", "query", "report"]
  },
  {
    name: "index",
    summary: "Report whether MAT index artifacts already exist for a heap.",
    usage: "mat index --heap <path> [--allowed-root <dir>] [--json]",
    examples: [
      "mat index --heap ./heap.hprof"
    ],
    related: ["report", "query", "run"]
  },
  {
    name: "catalog",
    summary: "Show the machine-readable capability directory for commands, reports, OQL, and errors.",
    usage: "mat catalog [all|commands|reports|oql|errors] [--json]",
    examples: [
      "mat catalog",
      "mat catalog commands --json",
      "mat catalog oql"
    ],
    related: ["doctor", "query", "run", "report"]
  }
];

export const REPORT_CATALOG: CatalogReportEntry[] = [
  {
    id: "org.eclipse.mat.api:suspects",
    summary: "Leak suspects report for root-cause triage.",
    examples: ["mat report org.eclipse.mat.api:suspects --heap ./heap.hprof"]
  },
  {
    id: "org.eclipse.mat.api:overview",
    summary: "Heap overview report with class histogram artifacts.",
    examples: ["mat report org.eclipse.mat.api:overview --heap ./heap.hprof"]
  },
  {
    id: "org.eclipse.mat.api:top_components",
    summary: "Top components report for retained-size hotspots.",
    examples: ["mat report org.eclipse.mat.api:top_components --heap ./heap.hprof"]
  },
  {
    id: "org.eclipse.mat.api:compare",
    summary: "Compare two heap dumps using baseline/snapshot2 options.",
    examples: [
      "mat report org.eclipse.mat.api:compare --heap ./new.hprof --option baseline=../baseline/old.hprof --allowed-root . --allowed-root ../baseline"
    ]
  },
  {
    id: "org.eclipse.mat.api:suspects2",
    summary: "Alternate leak suspects report variant.",
    examples: ["mat report org.eclipse.mat.api:suspects2 --heap ./heap.hprof"]
  },
  {
    id: "org.eclipse.mat.api:overview2",
    summary: "Alternate overview report variant.",
    examples: ["mat report org.eclipse.mat.api:overview2 --heap ./heap.hprof"]
  }
];

export const ERROR_CATALOG: CatalogErrorEntry[] = [
  {
    category: "MAT_NOT_FOUND",
    summary: "MAT launcher or Java runtime could not be resolved.",
    remediation: "Check MAT_HOME, MAT_LAUNCHER, JAVA_PATH, or run `mat doctor`."
  },
  {
    category: "HEAP_NOT_FOUND",
    summary: "Heap file path is missing, unreadable, or outside allowed roots.",
    remediation: "Fix the heap path, read permissions, or add --allowed-root / MAT_ALLOWED_ROOTS for extra heap directories."
  },
  {
    category: "WRITE_PERMISSION_DENIED",
    summary: "MAT cannot create index/report artifacts near the heap dump.",
    remediation: "Fix directory permissions. Report/query/run usually stage the heap automatically when the source directory is not writable."
  },
  {
    category: "MAT_PARSE_FAILED",
    summary: "MAT exited with a generic non-zero failure.",
    remediation: "Inspect stderr and retry with a smaller scope or corrected arguments."
  },
  {
    category: "MAT_TIMEOUT",
    summary: "MAT exceeded the configured timeout.",
    remediation: "Increase --timeout-sec or narrow the query/report."
  },
  {
    category: "INVALID_QUERY",
    summary: "OQL or command arguments are invalid for MAT parser mode.",
    remediation: "Use `mat catalog oql` for safe patterns and simplify the query."
  }
];

export function getCatalog(section: CatalogSection = "all"): CatalogSuccess {
  switch (section) {
    case "commands":
      return { status: "ok", section, commands: CLI_COMMANDS };
    case "reports":
      return { status: "ok", section, reports: REPORT_CATALOG };
    case "oql":
      return { status: "ok", section, oql: MAT_OQL_SPEC };
    case "errors":
      return { status: "ok", section, errors: ERROR_CATALOG };
    case "all":
    default:
      return {
        status: "ok",
        section: "all",
        commands: CLI_COMMANDS,
        reports: REPORT_CATALOG,
        oql: MAT_OQL_SPEC,
        errors: ERROR_CATALOG
      };
  }
}

export function findCliCommand(name: string | undefined): CatalogCommandEntry | undefined {
  if (!name) {
    return undefined;
  }
  return CLI_COMMANDS.find((command) => command.name === name);
}
