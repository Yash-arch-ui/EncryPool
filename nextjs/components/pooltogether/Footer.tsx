"use client";

import Link from "next/link";

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Protocol",
    links: [
      { label: "Vault", href: "/vaults" },
      { label: "Prizes", href: "/prizes" },
      { label: "Account", href: "/account" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Zama Docs", href: "https://docs.zama.org/", external: true },
      {
        label: "FHEVM Solidity",
        href: "https://docs.zama.org/protocol/solidity-guides/smart-contract/",
        external: true,
      },
      { label: "fhEVM Template", href: "https://github.com/zama-ai/fhevm-react-template", external: true },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "Zama Discord", href: "https://discord.com/invite/zama", external: true },
      { label: "Zama GitHub", href: "https://github.com/zama-ai", external: true },
    ],
  },
];

/** Port of pooltogether.com's Footer, re-pointed at this dApp's routes and the
 *  Zama/FHEVM ecosystem instead of PoolTogether properties. */
export const PoolFooter = () => (
  <footer className="bg-pt-bg-purple-darker">
    <div className="mx-auto grid max-w-[1440px] gap-10 px-8 py-14 sm:grid-cols-2 lg:grid-cols-4">
      {COLUMNS.map(column => (
        <div key={column.title} className="flex flex-col gap-3">
          <span className="font-averta text-sm font-bold uppercase tracking-wider text-pt-purple-400">
            {column.title}
          </span>
          <ul className="flex flex-col gap-2">
            {column.links.map(link => (
              <li key={link.label}>
                {link.external ? (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-pt-purple-100 hover:text-pt-purple-300"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link href={link.href} className="text-sm text-pt-purple-100 hover:text-pt-purple-300">
                    {link.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="flex flex-col justify-between gap-6 text-xs text-pt-purple-100/60 lg:text-right">
        <p>
          A confidential take on prize savings, built on FHEVM for the Zama Developer Program. Layout heritage:
          pooltogether.com (MIT). Not affiliated with PoolTogether Labs.
        </p>
        <span>Built with Zama&apos;s fully homomorphic encryption (FHEVM) · Sepolia testnet</span>
      </div>
    </div>
  </footer>
);
