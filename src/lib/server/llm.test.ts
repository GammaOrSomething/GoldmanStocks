/// <reference types="bun" />
import OpenAI from "openai";
import { describe, expect, test } from "bun:test";

import { LlmError, MAX_PROMPT_CHARS, MODEL, toLlmError } from "./llm.server";
import {
  DraftOffersInput,
  draftOffersWith,
  MAX_ITEMS_IN_PROMPT,
} from "./outreach";
import { ExplainPlanInput, explainPlanWith } from "./plan";

type Call = Record<string, unknown> & {
  response_format?: Record<string, unknown>;
};

/** A stand-in client that records requests and replies with `reply` (or throws it). */
function fakeClient(reply: unknown) {
  const calls: Call[] = [];
  const respond = async (params: Call) => {
    calls.push(params);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const client = {
    chat: { completions: { create: respond, parse: respond } },
  } as unknown as OpenAI;
  return { client, calls };
}

/** An SDK error instance without going through its constructor. */
function sdkError<T extends object>(ErrorClass: { prototype: T }): T {
  return Object.create(ErrorClass.prototype) as T;
}

const plan: ExplainPlanInput = {
  date: "2026-09-21",
  weather: { tempC: 14, note: "1 watering task skipped" },
  workers: [
    {
      name: "Liis Tamm",
      role: "Gardener",
      hours: 3,
      km: 0,
      stops: [
        {
          start: 8,
          duration: 3,
          title: "Lawn mowing",
          client: "Hotel Nordic Grand",
          site: "Front entrance",
        },
      ],
      skipped: [
        {
          start: 8,
          duration: 2,
          title: "Watering round",
          client: "Hotel Nordic Grand",
          site: "Terrace beds",
          weatherNote: "Skipped — 9 mm rain overnight",
        },
      ],
    },
  ],
};

const C2 = "2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c";
const C4 = "4c4c4c4c-4c4c-4c4c-8c4c-4c4c4c4c4c4c";
const P2 = "2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a";
const P4 = "4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a";

const opportunities: DraftOffersInput = {
  opportunities: [
    {
      clientId: C4,
      projectId: P4,
      client: "Riga Green Offices",
      contact: "Ilze Berzina",
      what: "hedge clipping due by 2026-09-20",
      value: 860,
      dueDate: "2026-09-20",
      items: ["Box hedge (Reception garden) — hedge clipping due 2026-09-20"],
    },
    {
      clientId: C2,
      projectId: P2,
      client: "Hotel Nordic Grand",
      contact: "Peeter Lill",
      what: "lawn mowing due by 2026-09-22",
      value: 290,
      dueDate: "2026-09-22",
      items: ["Main lawn (Front entrance) — lawn mowing due 2026-09-22"],
    },
  ],
};

describe("explainPlan", () => {
  test("asks the configured model and returns the text", async () => {
    const { client, calls } = fakeClient({
      choices: [
        {
          message: {
            role: "assistant",
            content: "Liis mows at the hotel; watering is off after rain.",
          },
        },
      ],
    });
    const text = await explainPlanWith(client, plan);
    expect(text).toBe("Liis mows at the hotel; watering is off after rain.");
    expect(calls[0]?.["model"]).toBe(MODEL);
    expect(
      String(calls[0]?.["messages"] && JSON.stringify(calls[0]["messages"])),
    ).toContain("Skipped — 9 mm rain overnight");
  });

  test("a refusal becomes a readable error", async () => {
    const { client } = fakeClient({
      choices: [
        { message: { role: "assistant", refusal: "no", content: null } },
      ],
    });
    await expect(explainPlanWith(client, plan)).rejects.toThrow("declined");
  });

  test("SDK errors are mapped to readable messages", async () => {
    const { client } = fakeClient(sdkError(OpenAI.RateLimitError));
    await expect(explainPlanWith(client, plan)).rejects.toThrow("rate-limited");
    expect(toLlmError(sdkError(OpenAI.AuthenticationError)).message).toContain(
      "API key was rejected",
    );
    expect(toLlmError(new Error("boom"))).toBeInstanceOf(LlmError);
  });
});

describe("draftOffers", () => {
  test("uses structured output and returns one draft per opportunity", async () => {
    const { client, calls } = fakeClient({
      choices: [
        {
          message: {
            role: "assistant",
            parsed: {
              offers: [
                {
                  projectId: P2,
                  subject: "Lawn mowing next week",
                  body: "Dear Peeter, …",
                },
                {
                  projectId: P4,
                  subject: "Box hedge clipping",
                  body: "Dear Ilze, …",
                },
              ],
            },
          },
        },
      ],
    });
    const now = new Date("2026-09-18T09:00:00Z");
    const offers = await draftOffersWith(client, opportunities, now);

    expect(calls[0]?.["model"]).toBe(MODEL);
    expect(calls[0]?.["response_format"]).toBeDefined();
    expect(offers.map((o) => o.projectId)).toEqual([P4, P2]); // input order
    expect(offers[0]).toMatchObject({
      clientId: C4,
      value: 860,
      subject: "Box hedge clipping",
      status: "draft",
      approvedAt: null,
      createdAt: now.toISOString(),
    });
  });

  test("drafts are never marked approved or sent", async () => {
    const { client } = fakeClient({
      choices: [
        {
          message: {
            role: "assistant",
            parsed: { offers: [{ projectId: P4, subject: "s", body: "b" }] },
          },
        },
      ],
    });
    const offers = await draftOffersWith(client, opportunities);
    expect(offers.every((o) => o.status === "draft")).toBe(true);
  });

  test("unparseable output and refusals are readable errors", async () => {
    const unparsed = fakeClient({
      choices: [{ message: { role: "assistant", parsed: null } }],
    });
    await expect(
      draftOffersWith(unparsed.client, opportunities),
    ).rejects.toThrow(LlmError);
    const refused = fakeClient({
      choices: [
        { message: { role: "assistant", refusal: "no", parsed: null } },
      ],
    });
    await expect(
      draftOffersWith(refused.client, opportunities),
    ).rejects.toThrow("declined");
  });
});

/** A reply that drafts one offer per project id, with the given subject. */
const offersReply = (subject: string) => ({
  choices: [
    {
      message: {
        role: "assistant",
        parsed: {
          offers: [P4, P2].map((projectId) => ({
            projectId,
            subject,
            body: "Dear client, …",
          })),
        },
      },
    },
  ],
});

// Signup is open, so anyone can reach these features with our OpenAI key: every request and
// every reply is bounded.
describe("cost limits", () => {
  test("the dashboard's plan and offers pass validation", () => {
    expect(ExplainPlanInput.safeParse(plan).success).toBe(true);
    expect(DraftOffersInput.safeParse(opportunities).success).toBe(true);
  });

  test("an oversized plan is refused before OpenAI is called", () => {
    const worker = plan.workers[0]!;
    for (const oversized of [
      { ...plan, date: "today" },
      { ...plan, workers: [{ ...worker, name: "x".repeat(201) }] },
      { ...plan, workers: Array(101).fill(worker) },
      {
        ...plan,
        workers: [{ ...worker, stops: Array(51).fill(worker.stops[0]) }],
      },
    ]) {
      expect(ExplainPlanInput.safeParse(oversized).success).toBe(false);
    }
  });

  test("the whole plan is capped, however its fields are combined", () => {
    const stop = { ...plan.workers[0]!.stops[0]!, title: "x".repeat(200) };
    const busy = { ...plan.workers[0]!, stops: Array(50).fill(stop) };
    const big = { ...plan, workers: Array(10).fill(busy) };
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_PROMPT_CHARS);
    expect(ExplainPlanInput.safeParse(big).success).toBe(false);
  });

  test("offers need real ids and bounded text", () => {
    const first = opportunities.opportunities[0]!;
    for (const bad of [
      { ...first, projectId: "p4" },
      { ...first, clientId: "c4" },
      { ...first, contact: "x".repeat(1001) },
      { ...first, dueDate: "soon" },
    ]) {
      expect(DraftOffersInput.safeParse({ opportunities: [bad] }).success).toBe(
        false,
      );
    }
  });

  test("a big site lists a few plants and counts the rest", () => {
    const first = opportunities.opportunities[0]!;
    const items = Array.from({ length: 25 }, (_, i) => `Plant ${i}`);
    const parsed = DraftOffersInput.parse({
      opportunities: [{ ...first, items }],
    });
    const sent = parsed.opportunities[0]!.items;
    expect(sent).toHaveLength(MAX_ITEMS_IN_PROMPT + 1);
    expect(sent.at(-1)).toBe(`and ${25 - MAX_ITEMS_IN_PROMPT} more plants`);
  });

  test("a long description is shortened to fit the offers table", () => {
    const first = opportunities.opportunities[0]!;
    const parsed = DraftOffersInput.parse({
      opportunities: [{ ...first, what: "w".repeat(500) }],
    });
    expect(parsed.opportunities[0]!.what).toHaveLength(200);
  });

  test("both calls cap the length of the reply", async () => {
    const planCall = fakeClient({
      choices: [{ message: { role: "assistant", content: "Fine." } }],
    });
    await explainPlanWith(planCall.client, plan);
    expect(planCall.calls[0]?.["max_completion_tokens"]).toBeNumber();

    const offerCall = fakeClient(offersReply("Hedge clipping"));
    await draftOffersWith(offerCall.client, opportunities);
    expect(offerCall.calls[0]?.["max_completion_tokens"]).toBeNumber();
  });

  test("a subject too long for the offers table is shortened, not a failed insert", async () => {
    const { client } = fakeClient(offersReply("s".repeat(300)));
    const offers = await draftOffersWith(client, opportunities);
    expect(offers).toHaveLength(2);
    expect(offers.every((o) => o.subject.length === 200)).toBe(true);
  });
});
