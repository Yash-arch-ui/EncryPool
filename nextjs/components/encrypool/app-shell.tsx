"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LockKeyhole, Menu, X } from "lucide-react";
import { EncrypoolConnectButton } from "~~/components/encrypool/EncrypoolConnectButton";

const links = [
  ["Vaults", "/vaults"],
  ["Account", "/account"],
  ["Prizes", "/prizes"],
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <Link href="/" className="flex items-center gap-3 font-serif text-xl font-bold">
            <span className="relative flex size-10 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary shadow-[0_0_28px_color-mix(in_srgb,var(--primary)_28%,transparent)]">
              <LockKeyhole />
              <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-secondary" />
            </span>
            Encrypool
          </Link>
          <nav className="hidden items-center gap-2 rounded-full border border-border/70 bg-card/55 p-1.5 md:flex">
            {links.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${pathname.startsWith(href) ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="hidden md:block">
            <EncrypoolConnectButton />
          </div>
          <button
            aria-label="Toggle navigation"
            aria-expanded={open}
            className="rounded-full border border-border p-2 md:hidden"
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
        {open && (
          <nav className="flex flex-col gap-2 border-t border-border bg-background/95 px-5 py-5 md:hidden">
            {links.map(([label, href]) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="rounded-xl px-4 py-3 text-sm font-semibold hover:bg-muted"
              >
                {label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      {children}
      <footer className="border-t border-border/70 bg-card/40">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 md:flex-row md:items-center md:justify-between lg:px-8">
          <p className="font-serif text-xl font-bold">Encrypool</p>
          <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
            {links.map(([label, href]) => (
              <Link key={href} href={href} className="hover:text-foreground">
                {label}
              </Link>
            ))}
            <a
              href="https://github.com/Yash-arch-ui/EncryPool"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground"
            >
              GitHub
            </a>
          </div>
          <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-secondary shadow-[0_0_12px_var(--secondary)]" />
            FHEVM · SEPOLIA
          </p>
        </div>
      </footer>
    </div>
  );
}
