"use client";

import { useSyncExternalStore } from "react";
import { defaultLocale } from "@/i18n/config";
import { GLOBAL_ERROR_MESSAGES } from "@/i18n/global-error-messages";
import { negotiateLocale } from "@/lib/locale-negotiation";

const subscribe = () => () => {};
const browserLocale = () => negotiateLocale(document.cookie, navigator.languages.join(","));

// Root error boundary: catches errors in the root layout itself, so it must
// render its own <html>/<body> and can't use the intl provider. The locale comes
// from the NEXT_LOCALE cookie, then the browser languages.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const locale = useSyncExternalStore(subscribe, browserLocale, () => defaultLocale);
  const e = GLOBAL_ERROR_MESSAGES[locale];
  return (
    <html lang={locale}>
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.75rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <p style={{ color: "#6b7280", fontFamily: "monospace", fontSize: "0.875rem" }}>500</p>
        <h1 style={{ fontSize: "2rem", margin: 0 }}>{e.title}</h1>
        <p style={{ color: "#6b7280", maxWidth: "28rem" }}>{e.message}</p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "0.5rem",
            fontSize: "0.875rem",
            textDecoration: "underline",
            cursor: "pointer",
            background: "none",
            border: 0,
          }}
        >
          {e.retry}
        </button>
      </body>
    </html>
  );
}
