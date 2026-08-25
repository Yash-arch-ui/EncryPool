"use client";

import { useMemo } from "react";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { Section } from "~~/components/pooltogether/ui/Section";
import { ConfidentialPrizePool } from "~~/contracts/ConfidentialPrizePool";
import { deploymentFor } from "~~/utils/contract";

/** Port of pooltogether.com's HeroSection. The social-proof line reads the
 *  live participant count straight from ConfidentialPrizePool.participantCount()
 *  on the connected chain — addresses are public, amounts never are. */
export function HeroSection() {
  const chainId = useChainId();
  const { isConnected } = useAccount();

  const pool = useMemo(() => deploymentFor(ConfidentialPrizePool, chainId), [chainId]);
  const hasPool = Boolean(pool?.address && pool?.abi);

  const { data: participantCount } = useReadContract({
    address: hasPool ? pool!.address : undefined,
    abi: hasPool ? pool!.abi : undefined,
    functionName: "participantCount" as const,
    query: {
      enabled: hasPool,
      refetchOnWindowFocus: false,
    },
  });

  const savers = typeof participantCount === "bigint" ? Number(participantCount) : null;
  const usersLabel = savers !== null && savers > 0 ? `${savers}` : isConnected ? "you" : null;

  return (
    <Section
      bg="indexSection1.svg"
      smallBg="mobileIndexSection1.svg"
      animatedBg="indexSection1.svg"
      className="aspect-[375/500] md:mt-0 md:aspect-[1600/835]"
    >
      <div className="relative mx-auto flex h-full w-full max-w-[1440px] flex-col">
        <div className="flex h-[34%] w-full flex-col justify-center gap-2 px-4 text-center md:ml-[5%] md:mt-[5.2%] md:h-[37.9%] md:max-w-[35%] md:flex-col md:gap-6 md:px-0 md:text-start">
          <h1 className="font-averta text-[2.5rem] font-bold !leading-tight lg:text-[2.5rem] xl:text-[3.5rem]">
            <span className="md:whitespace-nowrap">
              The <span className="text-pt-purple-400">No-Loss Protocol</span>
            </span>
            <br />
            <span>for Private Savings</span>
          </h1>
          <span className="text-base font-medium md:text-sm lg:text-base xl:text-2xl">
            {usersLabel
              ? `The permissionless protocol ${usersLabel} ${savers !== null && savers > 1 ? "people are" : "person is"} using to win by saving — without ever revealing an amount`
              : "The permissionless protocol for winning by saving — without ever revealing an amount"}
          </span>

          <a
            href="/vaults"
            className="mx-auto mt-6 w-fit rounded-lg bg-pt-teal px-6 py-2.5 font-medium text-pt-purple-800 transition-colors hover:bg-pt-teal-dark md:mx-0"
          >
            <span className="text-base">Start Saving</span>
          </a>
        </div>
      </div>
    </Section>
  );
}
