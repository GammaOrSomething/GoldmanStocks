import { createServerFn } from "@tanstack/react-start";
import { getAuthedClient } from "@/lib/api/session";

import { getOpenAI } from "@/lib/server/llm.server";
import { ExplainPlanInput, explainPlanWith } from "@/lib/server/plan";

// Server functions only: safe to import from routes (see weather.functions.ts).

export type { ExplainPlanInput } from "@/lib/server/plan";

/** Plain-language explanation of a day plan, for the "Approve today's plan" dialog. */
export const explainPlan = createServerFn({ method: "POST" })
  .validator(ExplainPlanInput)
  .handler(async ({ data }) => {
    await getAuthedClient(); // signed-in callers only: this spends the OpenAI key
    return explainPlanWith(getOpenAI(), data);
  });
