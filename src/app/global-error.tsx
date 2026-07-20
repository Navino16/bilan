"use client";

import fr from "../../messages/fr.json";

// Root error boundary: catches errors in the root layout itself, so it must
// render its own <html>/<body> and can't use the intl provider — default-locale
// (fr) strings inline.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const e = fr.errors;
  return (
    <html lang="fr">
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
        <h1 style={{ fontSize: "2rem", margin: 0 }}>{e.serverError.title}</h1>
        <p style={{ color: "#6b7280", maxWidth: "28rem" }}>{e.serverError.message}</p>
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
          {e.serverError.retry}
        </button>
      </body>
    </html>
  );
}
