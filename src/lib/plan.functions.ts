import { createServerFn } from "@tanstack/react-start";
import { requireBoss } from "@/lib/api/session";
import { spendAllowance } from "@/lib/api/usage";

import { getOpenAI } from "@/lib/server/llm.server";
import { ExplainPlanInput, explainPlanOrSkip } from "@/lib/server/plan";

// Server functions only: safe to import from routes (see weather.functions.ts).

export type { ExplainPlanInput } from "@/lib/server/plan";

/** Plain-language explanation of a day plan, for the "Approve today's plan" dialog. */
export const explainPlan = createServerFn({ method: "POST" })
  .validator(ExplainPlanInput)
  .handler(async ({ data }) => {
    const db = await requireBoss();
    // An empty day costs nothing; otherwise this spends the OpenAI key.
    return explainPlanOrSkip(
      data,
      () => spendAllowance(db, "ai_plan"),
      getOpenAI,
    );
  });
