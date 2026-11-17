import { handler, ok } from "@/server/api";
import { availableUpdate } from "@/server/app-update";

export const GET = handler(async () => ok({ version: await availableUpdate() }));
