/** Installation-local authentication is excluded from portable journal backups. */
export const AUTH_DIRECTORY = ".auth";
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;

export interface SecuritySettings {
  configured: boolean;
  managedByEnvironment: boolean;
}
