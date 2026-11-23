import type { Locale } from "./config";

// Copy of `errors.serverError` from messages/*.json, kept apart so the root error boundary
// doesn't bundle both catalogues; tests/unit/i18n/global-error-messages.test.ts keeps it in sync.
export const GLOBAL_ERROR_MESSAGES: Record<
  Locale,
  { title: string; message: string; retry: string }
> = {
  fr: {
    title: "Une erreur est survenue",
    message: "Un problème inattendu s’est produit. Réessayez dans un instant.",
    retry: "Réessayer",
  },
  en: {
    title: "Something went wrong",
    message: "An unexpected problem occurred. Try again in a moment.",
    retry: "Try again",
  },
};
