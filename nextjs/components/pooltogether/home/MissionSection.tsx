"use client";

import Image from "next/image";
import { cn } from "~~/components/pooltogether/cn";
import { Button } from "~~/components/pooltogether/ui";
import { Section } from "~~/components/pooltogether/ui/Section";

const ZAMA_DOCS = "https://docs.zama.org/protocol";
const GITHUB_TEMPLATE = "https://github.com/zama-ai/fhevm-react-template";

export function MissionSection() {
  return (
    <div className="relative flex w-full flex-col">
      <div className="mt-[20%] mb-[10%] flex w-full flex-col items-center justify-center gap-2 px-4 text-center md:absolute md:z-10 md:mb-0 md:mt-0 md:h-[47.2%] md:gap-10 md:px-0 xl:gap-20">
        <span className="text-xs text-pt-purple-100 lg:text-sm">Why Confidential Prize Savings?</span>
        <div className="mb-8 flex flex-col items-center gap-2 text-pt-purple-100 md:mb-0">
          <span className="font-averta text-[2rem] font-bold !leading-tight md:text-2xl md:!leading-normal lg:text-[2rem] xl:text-[2.5rem]">
            <span className="text-pt-purple-400">The Mission:</span> Financial freedom for all
          </span>
          <span className="text-base md:w-3/4 md:text-sm lg:text-lg xl:text-xl">
            Prize savings are a proven tool to help people save money and avoid wealth-destroying lotteries — encryption
            makes sure nobody can see your balance but you.
          </span>
        </div>
        <Button href={ZAMA_DOCS} target="_blank" rel="noopener noreferrer">
          <span className="px-[.4em] py-[.2em] text-base md:text-sm lg:text-base">Read More</span>
        </Button>
      </div>

      <Section
        bg="indexSection3.svg"
        smallBg="mobileIndexSection3.svg"
        animatedBg="indexSection3.svg"
        className="aspect-[375/1233] md:aspect-[1600/1410]"
      >
        <div className="absolute mt-[44%] flex h-auto w-full max-w-[86.8%] flex-col justify-center gap-2 p-4 text-pt-purple-100 md:ml-[4%] md:mt-[55.8%] md:h-[29.2%] md:max-w-[21%] md:flex-col md:gap-4 md:p-0">
          <span className="text-xs xl:text-sm">For Developers</span>
          <span className="font-averta text-[2rem] font-bold !leading-tight text-pt-purple-50 md:text-2xl lg:text-[2rem] xl:text-[2.5rem]">
            Build on FHEVM
          </span>
          <span className="text-base md:text-sm lg:text-base xl:text-xl">
            Fully homomorphic encryption unlocks prize savings where balances stay secret by default
          </span>
        </div>

        <div className="ml-[20%] mt-[174.8%] grid h-[43.5%] w-full max-w-[60%] grid-cols-1 justify-between gap-12 md:ml-[46.5%] md:mt-[62.6%] md:h-[19%] md:w-auto md:max-w-[47.5%] md:grid-cols-2 md:gap-4">
          <DeveloperCard
            src="/graphics/YieldGraphic.svg"
            title="Dev Documentation"
            href={ZAMA_DOCS}
            className="max-w-xs md:ml-auto"
          />
          <DeveloperCard
            src="/graphics/AddVaultGraphic.svg"
            title="FHEVM Template"
            href={GITHUB_TEMPLATE}
            className="max-w-xs"
          />
        </div>
      </Section>
    </div>
  );
}

function DeveloperCard({
  src,
  title,
  href,
  className,
}: {
  src: string;
  title: string;
  href: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col items-center gap-6 rounded-3xl bg-pt-bg-purple-darker p-6 md:p-3 xl:p-6",
        className,
      )}
    >
      <Image
        src="/icons/codeIcon.svg"
        width={24}
        height={24}
        alt=""
        aria-hidden="true"
        className="absolute left-4 top-4 h-auto w-5 text-pt-purple-400"
      />
      <Image src={src} alt="" aria-hidden="true" width={100} height={80} className="mt-2 w-3/4 grow" />
      <Button href={href} target="_blank" rel="noopener noreferrer" pill fullSized className="overflow-hidden">
        <span className="whitespace-nowrap text-sm md:text-xs xl:text-sm">{title}</span>
      </Button>
    </div>
  );
}
