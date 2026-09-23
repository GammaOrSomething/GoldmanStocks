import OpenAI from "openai";

/** Server-only OpenAI access. The `.server.ts` suffix keeps this out of the browser bundle. */

/** Overridable without a code change — set OPENAI_MODEL in .env to try a different one. */
export const MODEL = process.env["OPENAI_MODEL"] || "gpt-4o";

/**
 * The most a request may send the model, as serialised JSON. Each field is bounded too, but a
 * cap on the whole keeps one call's cost small however the fields are combined: signup is open,
 * so anyone can reach these features with our key. A real day plan or batch of offers is a few
 * thousand characters.
 */
export const MAX_PROMPT_CHARS = 60_000;

/** For a schema's `.refine`: the value fits in one prompt. */
export const fitsPrompt = (value: unknown) =>
  JSON.stringify(value).length <= MAX_PROMPT_CHARS;

/** A failure with a message that's safe and useful to show the boss. */
export class LlmError extends Error {
  override name = "LlmError";
}

let client: OpenAI | undefined;

export function getOpenAI(): OpenAI {
  if (!process.env["OPENAI_API_KEY"]) {
    throw new LlmError(
      "OPENAI_API_KEY is not set — add it to .env and restart the dev server.",
    );
  }
  client ??= new OpenAI();
  return client;
}

/** Turn SDK errors into a readable message (most specific first); pass LlmErrors through. */
export function toLlmError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof OpenAI.AuthenticationError) {
    return new LlmError(
      "The OpenAI API key was rejected — check OPENAI_API_KEY.",
    );
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new LlmError(
      "OpenAI is rate-limited right now — try again in a minute.",
    );
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new LlmError("Couldn't reach the OpenAI API — check the network.");
  }
  if (error instanceof OpenAI.APIError) {
    return new LlmError(
      `OpenAI request failed (${error.status ?? "no status"}).`,
    );
  }
  return new LlmError("OpenAI request failed.");
}

/**
 * Throw a readable error when the model declined the request.
 *
 * OpenAI surfaces this as a `refusal` string on the message rather than a stop reason, and it
 * can arrive on both plain and structured-output responses.
 */
export function assertNotRefused(message: { refusal?: string | null }) {
  if (message.refusal) {
    throw new LlmError("The model declined this request.");
  }
}
