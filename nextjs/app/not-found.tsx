import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex items-center h-full flex-1 justify-center bg-card">
      <div className="text-center">
        <h1 className="text-6xl font-bold m-0 mb-1">404</h1>
        <h2 className="text-2xl font-semibold m-0">Page Not Found</h2>
        <p className="text-muted-foreground m-0 mb-4">The page you&apos;re looking for doesn&apos;t exist.</p>
        <Link
          href="/"
          className="inline-block rounded-full bg-primary px-6 py-3 font-mono text-sm font-bold text-primary-foreground shadow-[0_0_36px_color-mix(in_srgb,var(--primary)_34%,transparent)] transition-transform hover:-translate-y-0.5"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
