import { ClientMessages } from "@/i18n/client-messages";

export default async function SetupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <ClientMessages scope="setup" locale={locale}>
      <div className="bg-background mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-12">
        {children}
      </div>
    </ClientMessages>
  );
}
