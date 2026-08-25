"use client";

import Image from "next/image";
import { cn } from "~~/components/pooltogether/cn";
import { Section, SimpleTextBanner } from "~~/components/pooltogether/ui";

type SavingCardType = "deposit" | "winPrizes" | "noLoss";

const CARDS: Record<SavingCardType, { src: string; title: string; description: string }> = {
  deposit: {
    src: "/graphics/DepositGraphic.svg",
    title: "Deposit",
    description: "Deposit cUSDT into the confidential vault — amounts stay encrypted",
  },
  winPrizes: {
    src: "/graphics/WinPrizesGraphic.svg",
    title: "Win Prizes",
    description: "Sponsored prize liquidity is drawn among eligible savers under encryption",
  },
  noLoss: {
    src: "/graphics/NoLossGraphic.svg",
    title: "No Loss",
    description: "No fees, withdraw any time — only you can decrypt your position",
  },
};

export function SavingSection() {
  return (
    <Section
      bg="indexSection2.svg"
      smallBg="mobileIndexSection2.svg"
      animatedBg="indexSection2.svg"
      className="aspect-[375/1408] md:aspect-[1600/1059]"
    >
      <SimpleTextBanner
        title={
          <>
            FHEgether is for <span className="text-pt-purple-400">Saving</span> &{" "}
            <span className="text-pt-purple-400">Winning</span>
          </>
        }
        className="h-[24.9%] w-full px-10 md:mt-[2%] md:h-[24.6%] md:px-0"
        titleClassName="!my-auto text-[2rem]"
      />
      <div className="flex h-[69.5%] w-full max-w-[60%] flex-col items-center justify-evenly mx-auto md:max-w-[77%] md:h-[59%] md:w-auto md:flex-row md:justify-between">
        {(Object.keys(CARDS) as SavingCardType[]).map(type => (
          <SavingCard key={type} type={type} className="max-w-[60%] md:max-w-[30%] md:grow" />
        ))}
      </div>
    </Section>
  );
}

function SavingCard({ type, className }: { type: SavingCardType; className?: string }) {
  const card = CARDS[type];

  return (
    <div className={cn("flex flex-col gap-6 md:gap-4 lg:gap-6", className)}>
      <div className="w-full rounded-2xl bg-pt-bg-purple-darker md:rounded-3xl">
        <Image src={card.src} alt={card.title} width={333} height={259} className="w-full" />
      </div>
      <div className="flex flex-col gap-1 text-center md:gap-2">
        <span className="font-averta text-2xl font-bold text-pt-purple-100 md:text-lg lg:text-2xl xl:text-[2rem]">
          {card.title}
        </span>
        <span className="min-h-[48px] text-base text-gray-100 md:min-h-[32px] md:text-xs lg:min-h-[40px] lg:text-sm xl:min-h-[48px] xl:text-base">
          {card.description}
        </span>
      </div>
    </div>
  );
}
