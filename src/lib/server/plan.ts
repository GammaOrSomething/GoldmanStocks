import type OpenAI from "openai";
import { z } from "zod/v4";

import { hasAssignedWork } from "@/lib/planner";

import {
  assertNotRefused,
  fitsPrompt,
  MAX_PROMPT_CHARS,
  MODEL,
  toLlmError,
} from "./llm.server";

/** Longest reply the model may write: 3–5 sentences, with room for a reasoning model. */
const MAX_REPLY_TOKENS = 1000;

const text = (max: number) => z.string().max(max);

const Stop = z.object({
  start: z.number().min(0).max(24),
  duration: z.number().min(0).max(24),
  title: text(200),
  client: text(200),
  site: text(200),
  weatherNote: text(1000).optional(),
});

/**
 * The day's plan as the dashboard shows it — built from planner.proposeDay(). Every field is
 * bounded, and so is the whole (see MAX_PROMPT_CHARS): this is sent to OpenAI on our key.
 */
export const ExplainPlanInput = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weather: z.object({
      tempC: z.number().min(-100).max(100).nullable(),
      note: text(500),
    }),
    workers: z
      .array(
        z.object({
          name: text(200),
          role: text(200),
          hours: z.number().min(0).max(24),
          km: z.number().min(0).max(10_000),
          stops: z.array(Stop).max(50),
          skipped: z.array(Stop).max(50),
        }),
      )
      .max(100),
  })
  .refine(fitsPrompt, {
    message: `This plan is too large to explain (over ${MAX_PROMPT_CHARS} characters)`,
  });
export type ExplainPlanInput = z.infer<typeof ExplainPlanInput>;

const SYSTEM = `You brief the owner of a Baltic landscaping company on today's crew plan, which \
was generated from each plant's care schedule and the live weather forecast.

Write 3–5 plain sentences, no lists, headings or markdown. Say who goes where and why the \
order makes sense, call out every change the weather caused (skipped or moved jobs), and \
flag anything the owner should check before approving: idle workers, long drives, or days \
over 7 hours. Use only the facts in the plan; don't invent jobs, times or weather.`;

/** Nobody has a job or a called-off job: nothing worth an AI call to explain. */
export function isEmptyPlan(plan: ExplainPlanInput): boolean {
  return !hasAssignedWork(plan.workers);
}

/** What the dialog says for an empty day, without asking the model. */
export const EMPTY_PLAN_EXPLANATION =
  "No one has a job assigned today, so there is no plan to explain yet.";

/**
 * The "Approve today's plan" explanation. An empty day is free; otherwise `spend` (the
 * company's daily AI allowance) runs first, and only then is the model asked.
 */
export async function explainPlanOrSkip(
  plan: ExplainPlanInput,
  spend: () => Promise<void>,
  client: () => OpenAI,
): Promise<string> {
  if (isEmptyPlan(plan)) return EMPTY_PLAN_EXPLANATION;
  await spend();
  return explainPlanWith(client(), plan);
}

/** Plain-language explanation of a day plan, for the "Approve today's plan" card. */
export async function explainPlanWith(
  client: OpenAI,
  plan: ExplainPlanInput,
): Promise<string> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(plan) },
      ],
      max_completion_tokens: MAX_REPLY_TOKENS,
    });
    const message = completion.choices[0]?.message;
    if (!message) throw new Error("empty response");
    assertNotRefused(message);
    const text = (message.content ?? "").trim();
    if (!text) throw new Error("empty response");
    return text;
  } catch (error) {
    throw toLlmError(error);
  }
}
