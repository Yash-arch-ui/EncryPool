"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReducedMotion } from "framer-motion";
import { RainbowKitCustomConnectButton } from "~~/components/helper";
import { cn } from "~~/components/pooltogether/cn";

const NAV_LINKS = [
  { href: "/vaults", name: "Vaults" },
  { href: "/prizes", name: "Prizes" },
  { href: "/account", name: "Account" },
] as const;

/** Port of pooltogether.com's sticky Navbar (transparent → darker on scroll)
 *  with this dApp's routes and the RainbowKit connect button in place of the
 *  original "Use PoolTogether" CTA. */
export const PoolNavbar = () => {
  const pathname = usePathname();
  const shouldReduceMotion = useReducedMotion();

  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={cn(
        "sticky top-0 z-40 flex w-full items-center justify-between gap-4 border-b border-pt-transparent !bg-transparent px-4 py-3 sm:px-8 md:py-4 md:shadow-2xl",
        !shouldReduceMotion && "transition",
        scrollY === 0 ? "md:!shadow-transparent" : "md:bg-pt-bg-purple-darker",
      )}
    >
      <Link href="/" className="flex items-center gap-2 shrink-0">
        <Image
          src="/graphics/pooltogether-white-mark.svg"
          alt=""
          aria-hidden="true"
          width={24}
          height={36}
          className="h-auto w-[18px]"
        />
        <span className="font-averta text-lg font-bold text-white md:text-xl">FHEgether</span>
      </Link>

      <div className="hidden items-center gap-8 md:flex">
        {NAV_LINKS.map(link => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "text-sm text-pt-purple-100 hover:text-pt-purple-300 lg:text-base",
              pathname?.startsWith(link.href) && "text-white",
            )}
          >
            {link.name}
          </Link>
        ))}
      </div>

      <div className="flex items-center gap-4 md:hidden">
        {NAV_LINKS.map(link => (
          <Link
            key={link.href}
            href={link.href}
            aria-label={link.name}
            className={cn("text-xs text-pt-purple-100", pathname?.startsWith(link.href) && "text-white")}
          >
            {link.name}
          </Link>
        ))}
      </div>

      <div className="shrink-0">
        <RainbowKitCustomConnectButton />
      </div>
    </nav>
  );
};
