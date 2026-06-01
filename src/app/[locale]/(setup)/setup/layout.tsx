export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-12">
      {children}
    </div>
  );
}
