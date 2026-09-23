import type { ReactNode } from "react";

import logoUrl from "@/assets/goldman-stocks-logo.png";
import { Card, CardContent } from "@/components/ui/card";

/** The centred card with the logo that sign-in, signup and onboarding share. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
  /** below the card, e.g. a link to the other form */
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <img
            src={logoUrl}
            alt=""
            className="size-10 rounded-lg object-cover shadow-sm"
          />
          <p className="font-display text-xl font-bold text-primary">
            Goldman Stocks
          </p>
        </div>

        <Card className="shadow-card">
          <CardContent className="p-6">
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            {subtitle ? (
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
            {children}
          </CardContent>
        </Card>

        {footer ? (
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {footer}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A form's error line, announced to screen readers. */
export function FormError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}
