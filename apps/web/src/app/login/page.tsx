import { redirect } from "next/navigation";
import { siteAuthEnabled } from "@/lib/siteAuth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  if (!siteAuthEnabled()) {
    redirect("/");
  }

  const params = await searchParams;
  const next = params.next && params.next.startsWith("/") ? params.next : "/";
  const errored = params.error === "1";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(1200px_600px_at_20%_-10%,#f3e7d9_0%,transparent_55%),linear-gradient(180deg,#faf7f2_0%,#f0ebe3_100%)] px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="font-display text-4xl tracking-tight text-ink-900">ATTATTA</div>
        <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-ink-600">
          Enter site password
        </p>

        <form
          action={`/api/login?next=${encodeURIComponent(next)}`}
          method="post"
          className="mt-8 space-y-4"
        >
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-ink-500">
              Password
            </span>
            <input
              type="password"
              name="password"
              autoFocus
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2.5 text-sm text-ink-900 outline-none ring-ember-500/30 focus:ring-2"
            />
          </label>

          {errored ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              Wrong password.
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-medium text-warm-paper hover:bg-ink-800"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
