export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1440px] gap-10 px-5 py-8 md:px-10 lg:px-16">
      <aside className="hidden w-44 shrink-0 sm:block">
        <div className="font-display text-3xl tracking-tight text-ink-900">ATTATTA</div>
        <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-ink-700">
          Celtra hopper
        </p>
        <nav className="mt-10 flex flex-col gap-3 text-sm">
          <a href="/" className="text-ink-900 transition-colors hover:text-ember-500">
            Campaigns
          </a>
          <a href="/library" className="text-ink-900 transition-colors hover:text-ember-500">
            Library
          </a>
          <a href="/comfy" className="text-ink-900 transition-colors hover:text-ember-500">
            Comfy
          </a>
          <a
            href="/api/logout"
            className="mt-6 text-xs uppercase tracking-[0.12em] text-ink-500 transition-colors hover:text-ink-800"
          >
            Sign out
          </a>
        </nav>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
