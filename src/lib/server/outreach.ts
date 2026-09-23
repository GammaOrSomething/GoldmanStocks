import type OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod/v4";

import type { Offer, OfferStatus } from "@/lib/types";

import {
  assertNotRefused,
  fitsPrompt,
  MAX_PROMPT_CHARS,
  MODEL,
  toLlmError,
} from "./llm.server";

/** Longest reply: up to 20 offers of about 120 words each, as JSON. */
const MAX_REPLY_TOKENS = 6000;

/** Plants listed per offer in the prompt; the rest are counted, so a big site stays cheap. */
export const MAX_ITEMS_IN_PROMPT = 10;

/** Column limits on `offers` (see the core migration). */
const OFFER_LIMITS = { what: 200, subject: 200, body: 20_000 } as const;

const clamp = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/**
 * Opportunities from outreach.findOpportunities(), as sent by the dashboard. Bounded, field by
 * field and as a whole (see MAX_PROMPT_CHARS), because it goes to OpenAI on our key; and shaped
 * to fit the `offers` table, so an insert can't fail after the call has been paid for.
 */
export const DraftOffersInput = z
  .object({
    opportunities: z
      .array(
        z.object({
          clientId: z.uuid(),
          projectId: z.uuid(),
          client: z.string().max(200),
          contact: z.string().max(1000),
          what: z
            .string()
            .max(1000)
            .transform((what) => clamp(what, OFFER_LIMITS.what)),
          value: z.number().min(0).max(1e9),
          dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          items: z
            .array(z.string().max(500))
            .max(1000)
            .transform((items) =>
              items.length > MAX_ITEMS_IN_PROMPT
                ? [
                    ...items.slice(0, MAX_ITEMS_IN_PROMPT),
                    `and ${items.length - MAX_ITEMS_IN_PROMPT} more plants`,
                  ]
                : items,
            ),
        }),
      )
      .min(1)
      .max(20),
  })
  .refine(fitsPrompt, {
    message: `Too much to draft at once (over ${MAX_PROMPT_CHARS} characters)`,
  });
export type DraftOffersInput = z.infer<typeof DraftOffersInput>;

const OfferDrafts = z.object({
  offers: z.array(
    z.object({
      projectId: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
  ),
});

const SYSTEM = `You draft short repeat-work offers from a Baltic landscaping company to its \
existing maintenance clients. Each offer goes to the named contact person, explains which \
plants are coming due and when (from the items given), proposes booking the work, and states \
the estimated price in euros exactly as given. Friendly, professional, under 120 words, in \
English. Sign off with "Best regards," and "[Your name]" on the next line — the owner fills \
in the name and reviews every draft before anything is sent. Return one offer per \
opportunity, using its projectId. Don't invent facts, discounts or dates.`;

/**
 * Draft one offer per opportunity. Returns `draft` offers only — nothing is sent;
 * the boss approves or dismisses each one.
 */
export async function draftOffersWith(
  client: OpenAI,
  input: DraftOffersInput,
  now = new Date(),
): Promise<Offer[]> {
  let parsed: z.infer<typeof OfferDrafts> | null;
  try {
    const completion = await client.chat.completions.parse({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(input.opportunities) },
      ],
      response_format: zodResponseFormat(OfferDrafts, "offer_drafts"),
      max_completion_tokens: MAX_REPLY_TOKENS,
    });
    const message = completion.choices[0]?.message;
    if (!message) throw new Error("empty response");
    assertNotRefused(message);
    parsed = message.parsed;
  } catch (error) {
    throw toLlmError(error);
  }
  if (!parsed) throw toLlmError(new Error("unparseable offer drafts"));

  const createdAt = now.toISOString();
  return input.opportunities.flatMap((opportunity): Offer[] => {
    const draft = parsed.offers.find(
      (o) => o.projectId === opportunity.projectId,
    );
    if (!draft) return [];
    return [
      {
        id: crypto.randomUUID(),
        clientId: opportunity.clientId,
        projectId: opportunity.projectId,
        what: opportunity.what,
        value: opportunity.value,
        dueDate: opportunity.dueDate,
        subject: clamp(draft.subject, OFFER_LIMITS.subject),
        body: clamp(draft.body, OFFER_LIMITS.body),
        status: "draft",
        createdAt,
        approvedAt: null,
      },
    ];
  });
}

// ─── Persistence (the `offers` table) — wired to track A's client at integration ─

type OfferRow = {
  id: string;
  client_id: string;
  project_id: string;
  what: string;
  value: number;
  due_date: string;
  subject: string;
  body: string;
  status: OfferStatus;
  created_at: string;
  approved_at: string | null;
};

const toRow = (o: Offer): OfferRow => ({
  id: o.id,
  client_id: o.clientId,
  project_id: o.projectId,
  what: o.what,
  value: o.value,
  due_date: o.dueDate,
  subject: o.subject,
  body: o.body,
  status: o.status,
  created_at: o.createdAt,
  approved_at: o.approvedAt,
});

const fromRow = (r: OfferRow): Offer => ({
  id: r.id,
  clientId: r.client_id,
  projectId: r.project_id,
  what: r.what,
  value: Number(r.value),
  dueDate: r.due_date,
  subject: r.subject,
  body: r.body,
  status: r.status,
  createdAt: r.created_at,
  approvedAt: r.approved_at,
});

export async function saveOffers(db: SupabaseClient, offers: Offer[]) {
  const { data, error } = await db
    .from("offers")
    .insert(offers.map(toRow))
    .select();
  if (error) throw error;
  return (data as OfferRow[]).map(fromRow);
}

/** Approve or dismiss a draft. Approving records when; it never sends anything. */
export async function setOfferStatus(
  db: SupabaseClient,
  id: string,
  status: OfferStatus,
  now = new Date(),
) {
  const { data, error } = await db
    .from("offers")
    .update({
      status,
      approved_at: status === "approved" ? now.toISOString() : null,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return fromRow(data as OfferRow);
}

export async function listDraftOffers(db: SupabaseClient) {
  const { data, error } = await db
    .from("offers")
    .select()
    .eq("status", "draft")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as OfferRow[]).map(fromRow);
}

/** An opportunity counts as handled for this long after an offer was drafted for its site. */
export const OFFER_COOLDOWN_DAYS = 30;

/**
 * Offers that are still waiting, plus any drafted in the last OFFER_COOLDOWN_DAYS (approved or
 * dismissed) — the sites these cover aren't offered again yet.
 */
export async function listRecentOffers(db: SupabaseClient, now = new Date()) {
  const since = new Date(
    now.getTime() - OFFER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await db
    .from("offers")
    .select()
    .or(`status.eq.draft,created_at.gte.${since}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as OfferRow[]).map(fromRow);
}
