import { db, accounts } from "@/db";
import { rebuildAccount } from "@/server/rebuild";
import { handler, ok, requireValue } from "@/server/api";
import {
  getMultipliers,
  getTimeZone,
  getTotalCapital,
  getHeaderMessage,
  setHeaderMessage,
  getImportTimeZone,
  setTotalCapital,
  aiKeyEnvironment,
  aiModelSetting,
  getAiProvider,
  getAiSettings,
  getOllamaBaseUrl,
  normalizeOllamaBaseUrl,
  setAiKey,
  setOllamaBaseUrl,
  setSetting,
  getSetting,
  getNavOrder,
  hasSavedNavOrder,
  setNavOrder,
} from "@/server/settings";
import { AI_PROVIDER_NAMES, isAiProvider, type AiProvider } from "@/lib/ai-settings";
import { PRIMARY_NAV_HREFS } from "@/lib/navigation";
import { isTimeZone } from "@/lib/timezone";

export const GET = handler(() =>
  ok({
    timeZone: getTimeZone(),
    headerMessage: getHeaderMessage(),
    importTimeZone: getImportTimeZone(),
    totalCapital: getTotalCapital(),
    multipliers: getMultipliers(),
    ...getAiSettings(),
    aiReviewLanguage: getSetting("aiReviewLanguage"),
    navOrder: getNavOrder(),
    navOrderSaved: hasSavedNavOrder(),
  }),
);

interface SettingsBody {
  timeZone?: string;
  headerMessage?: string;
  importTimeZone?: string;
  /** Whole trading pot across accounts; null clears it. Absent = unchanged. */
  totalCapital?: number | null;
  multipliers?: Record<string, number>;
  /** Set to a key string to store (encrypted), or null to clear. Absent = unchanged. */
  anthropicKey?: string | null;
  openaiKey?: string | null;
  openrouterKey?: string | null;
  ollamaBaseUrl?: string | null;
  aiProvider?: AiProvider;
  aiModel?: string;
  aiReviewLanguage?: string;
  navOrder?: string[];
}

export const PATCH = handler(async (request: Request) => {
  const body = (await request.json()) as SettingsBody;
  requireValue(body && typeof body === "object" && !Array.isArray(body), "Enter valid settings.");
  if (body.aiProvider !== undefined)
    requireValue(isAiProvider(body.aiProvider), "Choose Anthropic, OpenAI, OpenRouter, or Ollama.");
  const provider = body.aiProvider ?? getAiProvider();
  if (body.aiReviewLanguage !== undefined)
    requireValue(
      typeof body.aiReviewLanguage === "string" &&
        body.aiReviewLanguage.trim().length > 0 &&
        body.aiReviewLanguage.length <= 80,
      "Enter an answer language of 1–80 characters.",
    );
  if (body.aiModel !== undefined)
    requireValue(
      typeof body.aiModel === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(body.aiModel.trim()),
      "Enter a valid model ID.",
    );
  for (const id of ["anthropic", "openai", "openrouter"] as const) {
    const key = body[`${id}Key`];
    if (key === undefined) continue;
    requireValue(
      key === null ||
        (typeof key === "string" &&
          key.trim().length > 0 &&
          key.length <= 4096 &&
          !/\s/.test(key.trim())),
      `Enter a valid ${AI_PROVIDER_NAMES[id]} API key.`,
    );
    requireValue(
      !aiKeyEnvironment(id),
      `${AI_PROVIDER_NAMES[id]} uses an environment key. Update or remove it on the server.`,
    );
  }
  if (body.ollamaBaseUrl !== undefined && body.ollamaBaseUrl !== null) {
    requireValue(
      typeof body.ollamaBaseUrl === "string" &&
        body.ollamaBaseUrl.trim().length > 0 &&
        body.ollamaBaseUrl.length <= 500,
      "Enter a valid Ollama URL or IP address.",
    );
    try {
      normalizeOllamaBaseUrl(body.ollamaBaseUrl);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Enter a valid Ollama URL.");
    }
  }
  for (const key of ["timeZone", "importTimeZone"] as const)
    if (body[key] !== undefined)
      requireValue(
        isTimeZone(body[key]),
        `Enter a valid IANA ${key === "timeZone" ? "display" : "import"} timezone.`,
      );
  if (body.headerMessage !== undefined)
    requireValue(
      typeof body.headerMessage === "string" && body.headerMessage.length <= 10000,
      "Header message is too long.",
    );
  if (body.totalCapital !== undefined)
    requireValue(
      body.totalCapital === null ||
        (typeof body.totalCapital === "number" &&
          Number.isFinite(body.totalCapital) &&
          body.totalCapital >= 0),
      "Total capital must be a non-negative number.",
    );
  if (body.multipliers !== undefined)
    requireValue(
      body.multipliers &&
        typeof body.multipliers === "object" &&
        Object.values(body.multipliers).every(
          (n) => typeof n === "number" && Number.isFinite(n) && n > 0,
        ),
      "Contract multipliers must be positive numbers.",
    );
  if (
    provider === "ollama" &&
    body.ollamaBaseUrl !== null &&
    (body.ollamaBaseUrl !== undefined || body.aiProvider === "ollama" || body.aiModel !== undefined)
  ) {
    const baseUrl = normalizeOllamaBaseUrl(body.ollamaBaseUrl ?? getOllamaBaseUrl() ?? "");
    const model =
      body.aiModel?.trim() ||
      (body.aiProvider === "ollama" ? "qwen3:14b" : getAiSettings().aiConnections.ollama.model);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new Error(
        `Could not connect to Ollama at ${baseUrl}. Check the Mac mini address, port 11434, and firewall.`,
      );
    }
    if (!response.ok)
      throw new Error(`Ollama connection failed at ${baseUrl} (HTTP ${response.status}).`);
    const payload = (await response.json()) as { models?: { name?: unknown }[] };
    const names = Array.isArray(payload.models)
      ? payload.models.map((item) => String(item?.name ?? ""))
      : [];
    requireValue(
      names.includes(model),
      `Ollama is reachable, but model \"${model}\" is not installed. Run \"ollama pull ${model}\" on the Mac mini first.`,
    );
  }

  db.transaction(() => {
    // A display-only change must not silently alter the legacy import default.
    if (body.timeZone !== undefined || body.importTimeZone !== undefined)
      setSetting("importTimeZone", body.importTimeZone ?? getImportTimeZone());
    if (body.timeZone !== undefined) setSetting("timeZone", body.timeZone);
  });
  if (body.navOrder !== undefined)
    requireValue(
      Array.isArray(body.navOrder) &&
        body.navOrder.length === PRIMARY_NAV_HREFS.length &&
        new Set(body.navOrder).size === PRIMARY_NAV_HREFS.length &&
        body.navOrder.every((href) =>
          PRIMARY_NAV_HREFS.includes(href as (typeof PRIMARY_NAV_HREFS)[number]),
        ),
      "Enter a valid menu order.",
    );

  if (body.navOrder !== undefined) setNavOrder(body.navOrder);

  if (body.multipliers !== undefined)
    db.transaction(() => {
      setSetting("multipliers", JSON.stringify(body.multipliers));
      for (const account of db.select({ id: accounts.id }).from(accounts).all())
        rebuildAccount(account.id);
    });
  db.transaction(() => {
    for (const id of ["anthropic", "openai", "openrouter"] as const) {
      const key = body[`${id}Key`];
      if (key !== undefined) setAiKey(id, key);
    }
    if (body.ollamaBaseUrl !== undefined) setOllamaBaseUrl(body.ollamaBaseUrl);
    if (body.headerMessage !== undefined) setHeaderMessage(body.headerMessage);
    if (body.totalCapital !== undefined) setTotalCapital(body.totalCapital);
    if (body.aiProvider !== undefined) setSetting("aiProvider", body.aiProvider);
    if (body.aiModel !== undefined) setSetting(aiModelSetting(provider), body.aiModel.trim());
    if (body.aiReviewLanguage !== undefined)
      setSetting("aiReviewLanguage", body.aiReviewLanguage.trim());
  });
  return ok({ saved: true });
});
