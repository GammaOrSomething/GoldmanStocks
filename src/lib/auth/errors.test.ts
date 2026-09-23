/// <reference types="bun" />
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, test } from "bun:test";

import { OFFLINE, signInErrorMessage, signUpErrorMessage } from "./errors";

const api = (status: number, code: string) =>
  new AuthApiError("refused", status, code);

describe("signUpErrorMessage", () => {
  test("explains what the person can fix", () => {
    expect(signUpErrorMessage(api(422, "weak_password"))).toMatch(
      /at least 10 characters/,
    );
    expect(signUpErrorMessage(api(400, "email_address_invalid"))).toMatch(
      /email address/,
    );
  });

  test("passes on rate limits and outages", () => {
    expect(signUpErrorMessage(api(429, "over_request_rate_limit"))).toMatch(
      /Too many attempts/,
    );
    expect(signUpErrorMessage(new AuthRetryableFetchError("offline", 0))).toBe(
      OFFLINE,
    );
  });

  test("never echoes the server's own message", () => {
    const message = signUpErrorMessage(api(500, "unexpected_failure"));
    expect(message).toBe("Couldn't create the account. Try again.");
  });
});

describe("signInErrorMessage", () => {
  test("an unconfirmed account is told to confirm, not that the password is wrong", () => {
    expect(signInErrorMessage(api(400, "email_not_confirmed"))).toMatch(
      /Confirm your email/,
    );
  });

  test("never says whether the email has an account", () => {
    expect(signInErrorMessage(api(400, "invalid_credentials"))).toBe(
      "Wrong email or password.",
    );
    expect(signInErrorMessage(api(400, "user_not_found"))).toBe(
      "Wrong email or password.",
    );
  });

  test("passes on rate limits and outages", () => {
    expect(signInErrorMessage(api(429, "over_request_rate_limit"))).toMatch(
      /Too many attempts/,
    );
    expect(signInErrorMessage(new AuthRetryableFetchError("offline", 0))).toBe(
      OFFLINE,
    );
  });
});
