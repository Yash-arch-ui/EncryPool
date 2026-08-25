"use client";

import { type ReactNode, useEffect, useState } from "react";
import Image from "next/image";
import { useReducedMotion } from "framer-motion";
import { cn } from "~~/components/pooltogether/cn";

export interface SvgBackgroundProps {
  bg: `${string}.svg`;
  smallBg: `${string}.svg`;
  animatedBg?: `${string}.svg`;
  animatedSmallBg?: `${string}.svg`;
}

/** Port of pooltogether.com's SvgBackground: layered static <Image> + animated
 *  SVG <object>, falling back to static art under prefers-reduced-motion. */
export const SvgBackground = (props: SvgBackgroundProps) => {
  const { bg, smallBg, animatedBg, animatedSmallBg } = props;

  const shouldReduceMotion = useReducedMotion();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  const isBgAnimated = !!animatedBg && hydrated && !shouldReduceMotion;
  const isSmallBgAnimated = !!animatedSmallBg && hydrated && !shouldReduceMotion;

  const baseClassName = "absolute w-full -z-10";
  const bgClassName = "hidden md:block";
  const smallBgClassName = "md:hidden";

  return (
    <>
      <StaticBG
        src={isBgAnimated ? `/backgrounds/animated/${animatedBg}` : `/backgrounds/static/${bg}`}
        className={cn(baseClassName, bgClassName)}
      />
      <StaticBG
        src={
          isSmallBgAnimated ? `/backgrounds/animated/${animatedSmallBg ?? smallBg}` : `/backgrounds/static/${smallBg}`
        }
        className={cn(baseClassName, smallBgClassName)}
        isSmall={true}
      />
      {isBgAnimated && (
        <object
          type="image/svg+xml"
          data={`/backgrounds/animated/${animatedBg}`}
          className={cn(baseClassName, bgClassName, "-z-[5]")}
        />
      )}
      {isSmallBgAnimated && (
        <object
          type="image/svg+xml"
          data={`/backgrounds/animated/${animatedSmallBg}`}
          className={cn(baseClassName, smallBgClassName, "-z-[5]")}
        />
      )}
    </>
  );
};

interface StaticBGProps {
  src: string;
  isSmall?: boolean;
  className?: string;
}

const StaticBG = (props: StaticBGProps) => {
  const { src, isSmall, className } = props;

  return (
    <Image
      src={src}
      width={isSmall ? 375 : 1920}
      height={isSmall ? 667 : 1080}
      alt=""
      aria-hidden="true"
      className={className}
      priority={true}
    />
  );
};

interface SectionProps extends SvgBackgroundProps {
  children: ReactNode;
  className?: string;
}

export const Section = (props: SectionProps) => {
  const { children, className, ...rest } = props;

  return (
    <section className={cn("relative flex w-full flex-col isolate", className)}>
      <SvgBackground {...rest} />
      {children}
    </section>
  );
};

interface SimpleTextBannerProps {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
}

export const SimpleTextBanner = (props: SimpleTextBannerProps) => {
  const { title, description, className, titleClassName, descriptionClassName } = props;

  return (
    <div className={cn("flex flex-col items-center px-4 text-center text-pt-purple-50 md:px-0", className)}>
      <span
        className={cn(
          "mb-1 font-averta text-2xl font-bold !leading-normal md:text-2xl lg:text-[2rem] xl:text-[2.5rem]",
          titleClassName,
        )}
      >
        {title}
      </span>
      <span className={cn("text-sm xl:text-base", descriptionClassName)}>{description}</span>
    </div>
  );
};
