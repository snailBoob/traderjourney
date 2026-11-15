import {
  FORMATS,
  parseAuto,
  parseWithMapping,
  readHeaders,
  type GenericMapping,
  type ImportedExecution,
} from "@traderjourney/importers";
import { bad, handler, ok, requireValue, RequestError } from "@/server/api";
import { insertExecutions } from "@/server/executions";
import { getImportTimeZone } from "@/server/settings";
import { isTimeZone } from "@/lib/timezone";
import type { ImportReviewOptions } from "@/lib/import-review";
import { previewNinjaTraderImport, commitNinjaTraderImport } from "@/server/ninjatrader-import";
import type { AiImportOptions } from "@/lib/ai-import";
import { randomUUID } from "node:crypto";
import { withLogContext } from "@/server/log-context";
import { logInfo, logWarn, logError } from "@/server/logger";
import {
  createAiImportPreview,
  parseStatementWithAi,
  readAiImportPreview,
} from "@/server/ai-import";

interface ImportBody {
  mode: "preview" | "commit";
  content: string;
  accountId?: string;
  /** Column mapping when auto-detection found nothing. */
  mapping?: GenericMapping;
  timeZone?: string;
  fileName?: string;
  symbol?: string;
  review?: ImportReviewOptions;
  ai?: AiImportOptions;
  encoding?: "text" | "pdf";
  aiPreviewToken?: string;
  aiReviewed?: boolean;
}

/**
 * One endpoint, two steps. Preview parses and reports what WOULD be imported;
 * nothing is guessed silently, exactly because the file formats in the wild
 * drift. Commit inserts with dedup, so re-importing the same file is a no-op.
 */
const importFile = async (request: Request) => {
  const body = (await request.json()) as ImportBody;
  if (typeof body.content !== "string" || !body.content) return bad("content is required");
  if (!["preview", "commit"].includes(body.mode)) return bad("mode must be preview or commit");
  if (body.symbol !== undefined && (typeof body.symbol !== "string" || body.symbol.length > 100))
    return bad("Invalid symbol");
  if (body.fileName !== undefined && typeof body.fileName !== "string")
    return bad("Invalid filename");
  if (body.timeZone !== undefined)
    requireValue(isTimeZone(body.timeZone), "Enter a valid IANA statement timezone.");
  const timeZone = body.timeZone ?? getImportTimeZone();
  requireValue(
    body.encoding === undefined || body.encoding === "text" || body.encoding === "pdf",
    "Unsupported file encoding.",
  );
  requireValue(body.encoding !== "pdf" || body.ai, "Enable AI parsing to upload PDF statements.");
  requireValue(!body.ai || !body.mapping, "Choose AI parsing or column mapping, not both.");
  const statement = {
    content: body.content,
    fileName: body.fileName,
    encoding: body.encoding,
    timeZone,
  };
  if (body.ai && body.mode === "commit")
    requireValue(
      body.aiReviewed === true && body.aiPreviewToken,
      "Review the AI preview before importing.",
    );

  const parsed = body.ai
    ? body.mode === "preview"
      ? await parseStatementWithAi(statement, body.ai, request.signal)
      : readAiImportPreview(statement, body.aiPreviewToken!)
    : body.mapping
      ? parseWithMapping(body.content, body.mapping, { timeZone })
      : parseAuto(body.content, { timeZone, fileName: body.fileName, symbol: body.symbol });

  if (!parsed) {
    logInfo("import", "import.mapping_required", { mode: body.mode });
    return ok({
      detected: null,
      timeZone,
      headers: readHeaders(body.content),
      needsMapping: true,
    });
  }

  if (body.mode === "preview") {
    logInfo("import", "import.preview", {
      format: parsed.format,
      executions: parsed.executions.length,
      skipped: parsed.skippedRows,
      errors: parsed.errors?.length ?? 0,
    });
    const symbols = [...new Set(parsed.executions.map((e) => e.symbol))];
    return ok({
      detected: parsed.format,
      timeZone,
      needsMapping: false,
      executions: body.ai ? parsed.executions : parsed.executions.slice(0, 50),
      ...(body.ai
        ? {
            aiPreviewToken: createAiImportPreview(statement, parsed),
            sources: "sources" in parsed ? parsed.sources : [],
          }
        : {}),
      totals: {
        executions: parsed.executions.length,
        symbols: symbols.length,
        skippedRows: parsed.skippedRows,
        from: parsed.executions.reduce<string | null>(
          (min, e) => (min === null || e.executedAt < min ? e.executedAt : min),
          null,
        ),
        to: parsed.executions.reduce<string | null>(
          (max, e) => (max === null || e.executedAt > max ? e.executedAt : max),
          null,
        ),
      },
      warnings: parsed.warnings,
      errors: parsed.errors,
      needsSymbol: parsed.needsSymbol,
      reconciliation:
        parsed.format === "ninjatrader" && body.accountId
          ? previewNinjaTraderImport(body.accountId, parsed, body.content, timeZone, body.review)
          : undefined,
    });
  }

  if (!body.accountId) return bad("accountId is required to commit");
  if (parsed.errors?.length) return bad(parsed.errors.join(" "));
  if (parsed.executions.length === 0) return bad("No executions to import");
  const result =
    parsed.format === "ninjatrader"
      ? commitNinjaTraderImport(body.accountId, parsed, body.content, timeZone, body.review)
      : insertExecutions(
          body.accountId,
          parsed.executions as ImportedExecution[],
          "import",
          undefined,
          { preserveFees: Boolean(body.ai) },
        );
  // Invalid rows are skipped with a warning rather than failing the whole file.
  logInfo("import", "import.committed", {
    format: parsed.format,
    accountId: body.accountId,
    inserted: result.inserted,
    skipped: result.skipped,
    duplicates: result.duplicates,
  });
  const warnings = [
    ...(parsed.warnings ?? []),
    ...(result.skipped > 0
      ? [
          `${result.skipped} row(s) were skipped because they could not be journaled: ${result.skippedReasons.join(" ")}`,
        ]
      : []),
  ];
  return ok({ detected: parsed.format, ...result, warnings });
};

export const POST = handler((request: Request) =>
  withLogContext({ importId: randomUUID() }, async () => {
    const started = Date.now();
    logInfo("import", "import.started");
    try {
      const response = await importFile(request);
      (response.ok ? logInfo : logWarn)("import", "import.completed", {
        status: response.status,
        outcome: response.ok ? "success" : "rejected",
        durationMs: Date.now() - started,
      });
      return response;
    } catch (error) {
      if (error instanceof RequestError)
        logWarn("import", "import.rejected", {
          durationMs: Date.now() - started,
          outcome: "rejected",
        });
      else
        logError("import", "import.failed", error, {
          durationMs: Date.now() - started,
          outcome: "failure",
        });
      throw error;
    }
  }),
);

/** The import page lists what auto-detection understands. */
export const GET = handler(() => ok({ formats: FORMATS.map(({ id, label }) => ({ id, label })) }));
