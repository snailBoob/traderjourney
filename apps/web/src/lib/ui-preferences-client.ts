import { postJson, useApi } from "./use-api";
import type { UiPreferenceKey } from "./ui-preferences";

export interface UiPreferencesPayload {
  preferences: Record<string, unknown>;
}

export const useUiPreferences = () => useApi<UiPreferencesPayload>("/api/settings/ui");

export const saveUiPreference = (key: UiPreferenceKey, value: unknown) =>
  postJson("/api/settings/ui", { key, value }, "PATCH");
