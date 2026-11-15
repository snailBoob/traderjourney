import { AsyncLocalStorage } from "node:async_hooks";

type LogContext = { requestId?: string; syncId?: string; importId?: string };
const context = new AsyncLocalStorage<LogContext>();
export const getLogContext = () => context.getStore() ?? {};
export const withLogContext = <T>(values: LogContext, action: () => T): T =>
  context.run({ ...getLogContext(), ...values }, action);
