"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useTargetNetwork } from "~~/hooks/helper/useTargetNetwork";

/**
 * Encrypool header connect button. Uses the template's RainbowKit + wagmi
 * stack (ConnectButton.Custom) while preserving the placeholder's exact
 * visual style: a single font-mono pill in the header.
 */
export const EncrypoolConnectButton = () => {
  const { targetNetwork } = useTargetNetwork();

  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openChainModal, openAccountModal, mounted }) => {
        const connected = mounted && account && chain;
        const wrongNetwork = Boolean(connected && (chain.unsupported || chain.id !== targetNetwork.id));

        const pill =
          "rounded-full border border-primary/50 bg-primary/10 px-4 py-2 font-mono text-xs text-primary transition-colors hover:bg-primary hover:text-primary-foreground";

        if (!connected) {
          return (
            <button className={pill} onClick={openConnectModal} type="button">
              connect_wallet
            </button>
          );
        }

        if (wrongNetwork) {
          return (
            <button className={pill} onClick={openChainModal} type="button">
              wrong_network
            </button>
          );
        }

        return (
          <button className={pill} onClick={openAccountModal} type="button">
            {account.displayName}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
};
