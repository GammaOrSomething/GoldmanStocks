import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";

import { requireBoss } from "@/lib/api/session";
import { spendAllowance } from "@/lib/api/usage";
import { getOpenAI } from "@/lib/server/llm.server";
import {
  DraftOffersInput,
  draftOffersWith,
  listRecentOffers,
  saveOffers,
  setOfferStatus,
} from "@/lib/server/outreach";

// Server functions only: safe to import from routes (see weather.functions.ts).

/**
 * Offers still waiting for a decision, plus those drafted in the last 30 days (approved or
 * dismissed), newest first. The dashboard reviews the waiting ones and doesn't re-offer sites
 * covered by any of them.
 */
export const listOffers = createServerFn({ method: "GET" }).handler(async () =>
  listRecentOffers(await requireBoss()),
);

/**
 * Draft one repeat-work offer per opportunity and save them as drafts. Sites that already have
 * a waiting or recent offer are skipped, so drafting twice doesn't pile up duplicates. Nothing
 * is ever sent.
 */
export const draftOffers = createServerFn({ method: "POST" })
  .validator(DraftOffersInput)
  .handler(async ({ data }) => {
    const db = await requireBoss();
    const covered = new Set(
      (await listRecentOffers(db)).map((o) => o.projectId),
    );
    const fresh = data.opportunities.filter((o) => !covered.has(o.projectId));
    if (fresh.length === 0) return { drafted: 0 };
    await spendAllowance(db, "ai_outreach");
    const drafts = await draftOffersWith(getOpenAI(), { opportunities: fresh });
    await saveOffers(db, drafts);
    return { drafted: drafts.length };
  });

/** Approve or dismiss a draft. Approving only records the decision — it sends nothing. */
export const decideOffer = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.uuid(),
      status: z.enum(["approved", "dismissed"]),
    }),
  )
  .handler(async ({ data }) =>
    setOfferStatus(await requireBoss(), data.id, data.status),
  );
