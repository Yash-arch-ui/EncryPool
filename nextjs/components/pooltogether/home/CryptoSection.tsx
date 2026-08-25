"use client";

import { Button } from "~~/components/pooltogether/ui";
import { Section } from "~~/components/pooltogether/ui/Section";

const FHEVM_DOCS = "https://docs.zama.org/protocol";

export function CryptoSection() {
  return (
    <Section
      bg="indexSection4.svg"
      smallBg="mobileIndexSection4.svg"
      animatedBg="indexSection4.svg"
      className="aspect-[375/652] md:aspect-[1600/1028]"
    >
      <div className="mt-[58%] flex w-full flex-col items-center justify-center px-6 text-center md:mt-[26.8%] md:h-full md:px-0">
        <span className="px-2 font-averta text-[2rem] font-bold !leading-normal text-pt-bg-purple-darker md:text-2xl lg:text-[2rem] xl:text-[2.5rem]">
          Why a Crypto Protocol?
        </span>
        <span className="font-averta text-[2rem] font-bold !leading-normal md:mb-6 md:text-2xl lg:text-[2rem] xl:text-[2.5rem]">
          Because it&apos;s Transparent yet Confidential
        </span>
        <span className="mb-6 text-base text-pt-purple-100 md:max-w-[55%] md:text-sm lg:mb-10 lg:text-base xl:text-xl 3xl:max-w-[50%]">
          Smart contracts automate draws according to unchangeable rules, while FHE keeps every deposit, balance and win
          encrypted — more transparent, fair and accessible than ever.
        </span>
        <Button href={FHEVM_DOCS} target="_blank" rel="noopener noreferrer" color="white" active={true}>
          <span className="text-base md:text-xs lg:text-sm xl:text-base">Learn how it works</span>
        </Button>
      </div>
    </Section>
  );
}
