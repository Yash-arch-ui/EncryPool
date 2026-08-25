"use client";

import { PoolNavbar } from "~~/components/pooltogether/Navbar";

/** Site header — PoolTogether-style navbar with the RainbowKit connect
 *  button wired to the dApp's wagmi + Zama providers. Rendered app-wide by
 *  DappWrapperWithProviders. */
export const Header = () => {
  return <PoolNavbar />;
};
