"use client";

import { Address, formatEther } from "viem";
import { useTargetNetwork } from "~~/hooks/helper/useTargetNetwork";
import { useWatchBalance } from "~~/hooks/helper/useWatchBalance";

type BalanceProps = {
  address?: Address;
  className?: string;
  usdMode?: boolean;
};

/**
 * Display (ETH & USD) balance of an ETH address.
 */
export const Balance = ({ address, className = "" }: BalanceProps) => {
  const { targetNetwork } = useTargetNetwork();

  const {
    data: balance,
    isError,
    isLoading,
  } = useWatchBalance({
    address,
  });

  if (!address || isLoading || balance === null) {
    return (
      <div className="animate-pulse flex space-x-4">
        <div className="rounded-md bg-muted h-6 w-6"></div>
        <div className="flex items-center space-y-6">
          <div className="h-2 w-28 bg-muted rounded-sm"></div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="border-2 border-destructive/30 rounded-md px-2 flex flex-col items-center max-w-fit cursor-pointer">
        <div className="text-destructive">Error</div>
      </div>
    );
  }

  const formattedBalance = balance ? Number(formatEther(balance.value)) : 0;

  return (
    <div className={`flex flex-col font-normal items-center rounded-lg px-2 py-1 hover:bg-muted transition-colors ${className}`}>
      <div className="w-full flex items-center justify-center">
        <>
          <span>{formattedBalance.toFixed(4)}</span>
          <span className="text-[0.8em] font-bold ml-1">{targetNetwork.nativeCurrency.symbol}</span>
        </>
      </div>
    </div>
  );
};
