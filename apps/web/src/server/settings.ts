import { eq } from "drizzle-orm";
import { db, settings } from "@/db";
import { decryptJson, encryptJson } from "./crypto";
import { EMPTY_DEFAULTS, type JournalDefaults } from "@/lib/journal-defaults";
import { PRIMARY_NAV_HREFS } from "@/lib/navigation";
import {
  AI_DEFAULT_MODELS,
  isAiProvider,
  type AiProvider,
  type AiSettingsPayload,
} from "@/lib/ai-settings";

export const getJournalDefaults = (): JournalDefaults => {
  try {
    return { ...EMPTY_DEFAULTS, ...JSON.parse(getSetting("journalDefaults") ?? "{}") };
  } catch {
    return EMPTY_DEFAULTS;
  }
};

export const getSetting = (key: string): string | null =>
  db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;

export const setSetting = (key: string, value: string): void => {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
};

export const deleteSetting = (key: string): void => {
  db.delete(settings).where(eq(settings.key, key)).run();
};

const LEGACY_NAV_HREFS: Record<string, (typeof PRIMARY_NAV_HREFS)[number]> = {
  "/playbooks": "/strategies",
  "/progress": "/routines",
};

const normalizeNavOrder = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const valid = value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const href = LEGACY_NAV_HREFS[item] ?? item;
    return PRIMARY_NAV_HREFS.includes(href as (typeof PRIMARY_NAV_HREFS)[number])
      ? [href as (typeof PRIMARY_NAV_HREFS)[number]]
      : [];
  });
  const unique = [...new Set(valid)];
  if (unique.length !== PRIMARY_NAV_HREFS.length) return null;
  return unique;
};

export const getNavOrder = (): string[] => {
  const raw = getSetting("navOrder");
  if (!raw) return [...PRIMARY_NAV_HREFS];
  try {
    return normalizeNavOrder(JSON.parse(raw)) ?? [...PRIMARY_NAV_HREFS];
  } catch {
    return [...PRIMARY_NAV_HREFS];
  }
};

export const hasSavedNavOrder = (): boolean => getSetting("navOrder") !== null;

export const setNavOrder = (value: string[]): void => {
  const normalized = normalizeNavOrder(value);
  if (!normalized) throw new Error("Enter a valid menu order.");
  setSetting("navOrder", JSON.stringify(normalized));
};

/** Journal display timezone (IANA), default UTC. */
export const getTimeZone = (): string => getSetting("timeZone") ?? "UTC";

/** Whole trading pot across accounts; null until the user sets it. */
export const getTotalCapital = (): number | null => {
  const raw = getSetting("totalCapital");
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export const setTotalCapital = (value: number | null): void => {
  if (value === null || !Number.isFinite(value) || value < 0) deleteSetting("totalCapital");
  else setSetting("totalCapital", String(value));
};

export const getHeaderMessage = (): string => getSetting("headerMessage") ?? "";

export const setHeaderMessage = (value: string): void => {
  const normalized = value.trim();
  if (!normalized) deleteSetting("headerMessage");
  else setSetting("headerMessage", normalized);
};

/** Preserve the legacy parsing default until a separate import zone is saved. */
export const getImportTimeZone = (): string => getSetting("importTimeZone") ?? getTimeZone();

/** Per-symbol contract multipliers for futures/options P&L. */
export const getMultipliers = (): Record<string, number> => {
  const raw = getSetting("multipliers");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
};

export const aiKeyEnvironment = (provider: AiProvider): string | null => {
  const value =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : provider === "openrouter"
          ? process.env.OPENROUTER_API_KEY
          : undefined;
  return value?.trim() || null;
};

export const normalizeOllamaBaseUrl = (value: string): string => {
  let raw = value.trim();
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Enter a valid Ollama URL.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error("Enter an Ollama URL without credentials or query parameters.");
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  return url.toString().replace(/\/$/, "");
};

export const getOllamaBaseUrl = (): string | null => {
  const value = getSetting("ollamaBaseUrl")?.trim();
  if (!value) return null;
  try {
    return normalizeOllamaBaseUrl(value);
  } catch {
    return null;
  }
};

export const setOllamaBaseUrl = (value: string | null): void => {
  if (value === null) deleteSetting("ollamaBaseUrl");
  else setSetting("ollamaBaseUrl", normalizeOllamaBaseUrl(value));
};

/** Provider keys are stored separately and encrypted like broker credentials. */
export const getAiKey = (provider: AiProvider): string | null => {
  const environment = aiKeyEnvironment(provider);
  if (environment) return environment;
  const envelope = getSetting(`${provider}KeyEnc`);
  if (!envelope) return null;
  try {
    const key = decryptJson<unknown>(envelope);
    return typeof key === "string" ? key.trim() || null : null;
  } catch {
    return null;
  }
};

export const setAiKey = (provider: AiProvider, key: string | null): void => {
  if (key === null) deleteSetting(`${provider}KeyEnc`);
  else setSetting(`${provider}KeyEnc`, encryptJson(key.trim()));
};

export const getAnthropicKey = (): string | null => getAiKey("anthropic");
export const setAnthropicKey = (key: string | null): void => setAiKey("anthropic", key);

export const getAiProvider = (): AiProvider => {
  const selected = getSetting("aiProvider");
  if (isAiProvider(selected)) return selected;
  // Preserve existing Anthropic/OpenAI defaults while detecting a sole configured OpenRouter key.
  if (getAiKey("anthropic")) return "anthropic";
  if (getAiKey("openai")) return "openai";
  if (getAiKey("openrouter")) return "openrouter";
  return "anthropic";
};

export const aiModelSetting = (provider: AiProvider): string =>
  provider === "anthropic"
    ? "aiModel"
    : provider === "openai"
      ? "openaiModel"
      : provider === "openrouter"
        ? "openrouterModel"
        : "ollamaModel";

export const getAiModel = (provider: AiProvider): string =>
  getSetting(aiModelSetting(provider))?.trim() || AI_DEFAULT_MODELS[provider];

export const getAiSettings = (): AiSettingsPayload => {
  const aiProvider = getAiProvider();
  const connection = (provider: AiProvider) => ({
    configured: provider === "ollama" ? Boolean(getOllamaBaseUrl()) : Boolean(getAiKey(provider)),
    source:
      provider === "ollama"
        ? getOllamaBaseUrl()
          ? ("saved" as const)
          : null
        : aiKeyEnvironment(provider)
          ? ("environment" as const)
          : getAiKey(provider)
            ? ("saved" as const)
            : null,
    model: getAiModel(provider),
    ...(provider === "ollama" && getOllamaBaseUrl() ? { baseUrl: getOllamaBaseUrl()! } : {}),
  });
  const aiConnections = {
    anthropic: connection("anthropic"),
    openai: connection("openai"),
    openrouter: connection("openrouter"),
    ollama: connection("ollama"),
  };
  return {
    aiProvider,
    aiConfigured: aiConnections[aiProvider].configured,
    aiModel: aiConnections[aiProvider].model,
    aiConnections,
  };
};
