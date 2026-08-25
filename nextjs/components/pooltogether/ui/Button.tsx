"use client";

import { cn } from "~~/components/pooltogether/cn";

export type ButtonColor = "teal" | "purple" | "white" | "transparent";

type CommonProps = {
  color?: ButtonColor;
  /** Renders the outline variant of `color`. */
  active?: boolean;
  pill?: boolean;
  fullSized?: boolean;
};

type ButtonAsButton = CommonProps & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> & { href?: undefined };

type ButtonAsLink = CommonProps & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "color"> & { href: string };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

const FILLED: Record<ButtonColor, string> = {
  teal: "text-pt-purple-800 bg-pt-teal border-pt-teal hover:bg-pt-teal-dark focus:ring-pt-teal-dark",
  purple: "text-pt-purple-700 bg-pt-purple-100 border-pt-purple-100 hover:bg-pt-purple-200 focus:ring-pt-purple-50",
  white: "text-gray-900 bg-white border-white hover:bg-gray-100 focus:ring-gray-100",
  transparent:
    "text-pt-purple-100 bg-pt-transparent border-pt-transparent hover:bg-pt-purple-50/20 focus:ring-pt-purple-50",
};

const OUTLINE: Record<ButtonColor, string> = {
  teal: "text-pt-teal border-pt-teal bg-transparent hover:text-pt-purple-800 hover:bg-pt-teal",
  purple: "text-pt-purple-100 border-pt-purple-100 bg-transparent hover:bg-pt-transparent",
  white: "text-white border-white bg-transparent hover:text-gray-900 hover:bg-white",
  transparent: "text-pt-purple-50 border-pt-transparent bg-transparent hover:text-pt-purple-100",
};

/** Port of pooltogether.com's shared <Button> (flowbite theme) to a
 *  dependency-free component with the same visual contract. */
export const Button = (props: ButtonProps) => {
  const {
    color = "teal",
    active,
    pill,
    fullSized,
    className,
    ...rest
  } = props as CommonProps &
    React.AnchorHTMLAttributes<HTMLAnchorElement> &
    React.ButtonHTMLAttributes<HTMLButtonElement>;

  const classes = cn(
    "group flex h-min items-center justify-center p-0.5 text-center font-medium focus:z-10 focus:ring-4",
    pill ? "rounded-full" : "rounded-lg",
    active ? OUTLINE[color] : FILLED[color],
    fullSized && "w-full",
    className,
  );

  if ("href" in props && props.href !== undefined) {
    return (
      <a className={classes} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {(rest as { children?: React.ReactNode }).children}
      </a>
    );
  }

  return (
    <button type="button" className={classes} {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
      {(rest as { children?: React.ReactNode }).children}
    </button>
  );
};
