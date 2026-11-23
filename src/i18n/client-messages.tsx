import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { CLIENT_SCOPES, type ClientScope } from "./client-scopes";
import { pickMessages } from "./pick-messages";

// Ships only the namespaces the client components below use (spec §8.5). A nested provider
// replaces its parent's messages: a scope lists everything its subtree needs.
export async function ClientMessages({
  scope,
  locale,
  children,
}: {
  scope: ClientScope;
  locale: string;
  children: React.ReactNode;
}) {
  const messages = await getMessages({ locale });
  return (
    <NextIntlClientProvider locale={locale} messages={pickMessages(messages, CLIENT_SCOPES[scope])}>
      {children}
    </NextIntlClientProvider>
  );
}

export function messagesLayout(scope: ClientScope) {
  return async function MessagesLayout({
    children,
    params,
  }: {
    children: React.ReactNode;
    params: Promise<{ locale: string }>;
  }) {
    const { locale } = await params;
    return (
      <ClientMessages scope={scope} locale={locale}>
        {children}
      </ClientMessages>
    );
  };
}
