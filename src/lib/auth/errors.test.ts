/// <reference types="bun" />
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";
import { describe, expect, test } from "bun:test";

import {
  OFFLINE,
  resetPasswordErrorMessage,
  setPasswordErrorMessage,
  signInErrorMessage,
  signUpErrorMessage,
} from "./errors";

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

describe("resetPasswordErrorMessage", () => {
  test("only an outage or too many requests from this device is worth saying", () => {
    expect(
      resetPasswordErrorMessage(new AuthRetryableFetchError("offline", 0)),
    ).toBe(OFFLINE);
    expect(
      resetPasswordErrorMessage(api(429, "over_request_rate_limit")),
    ).toMatch(/Too many attempts/);
  });

  test("anything else reads as sent, so no one learns which emails have accounts", () => {
    expect(resetPasswordErrorMessage(api(400, "user_not_found"))).toBeNull();
    expect(
      resetPasswordErrorMessage(api(500, "unexpected_failure")),
    ).toBeNull();
    // Supabase limits emails per address, which only happens for an address with an account.
    expect(
      resetPasswordErrorMessage(api(429, "over_email_send_rate_limit")),
    ).toBeNull();
  });
});

describe("setPasswordErrorMessage", () => {
  test("explains what the person can fix", () => {
    expect(setPasswordErrorMessage(api(422, "weak_password"))).toMatch(
      /at least 10 characters/,
    );
    expect(setPasswordErrorMessage(api(422, "same_password"))).toMatch(
      /different/,
    );
  });

  test("a stale or missing session means the link has to be requested again", () => {
    expect(
      setPasswordErrorMessage(api(400, "reauthentication_needed")),
    ).toMatch(/expired/);
    expect(setPasswordErrorMessage(new AuthSessionMissingError())).toMatch(
      /expired/,
    );
  });

  test("passes on outages and never echoes the server", () => {
    expect(
      setPasswordErrorMessage(new AuthRetryableFetchError("offline", 0)),
    ).toBe(OFFLINE);
    expect(setPasswordErrorMessage(api(500, "unexpected_failure"))).not.toMatch(
      /refused/,
    );
  });
});
