import { useRef, useState } from "react";
import { NetworkOptions } from "./NetworkOptions";
import { Address, getAddress } from "viem";
import { useDisconnect } from "wagmi";
import { ArrowLeftIcon } from "@heroicons/react/20/solid";
import { ArrowsRightLeftIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { BlockieAvatar } from "~~/components/helper";
import { useOutsideClick } from "~~/hooks/helper";
import { getTargetNetworks } from "~~/utils/helper";

const allowedNetworks = getTargetNetworks();

type AddressInfoDropdownProps = {
  address: Address;
  displayName: string;
  ensAvatar?: string;
  blockExplorerAddressLink?: string;
};

export const AddressInfoDropdown = ({ address, ensAvatar, displayName }: AddressInfoDropdownProps) => {
  const { disconnect } = useDisconnect();
  const checkSumAddress = getAddress(address);

  const [selectingNetwork, setSelectingNetwork] = useState(false);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const closeDropdown = () => {
    setSelectingNetwork(false);
    setOpen(false);
  };

  useOutsideClick(dropdownRef, closeDropdown);

  return (
    <div ref={dropdownRef} className="relative leading-3">
      <button
        className="flex items-center gap-0 rounded-full border border-secondary/50 bg-secondary/10 px-2 py-1 text-xs font-semibold text-secondary shadow-md transition-colors hover:bg-secondary/20"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <BlockieAvatar address={checkSumAddress} size={30} ensImage={ensAvatar} />
        <span className="ml-2 mr-1">{displayName}</span>
        <ChevronDownIcon className="h-4 w-4 ml-1" />
      </button>
      {open && (
        <ul className="absolute right-0 z-20 mt-2 min-w-[200px] rounded-xl border border-border bg-card p-2 shadow-xl gap-1 flex flex-col">
          <NetworkOptions hidden={!selectingNetwork} />
          {allowedNetworks.length > 1 ? (
            <li className={selectingNetwork ? "hidden" : ""}>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                type="button"
                onClick={() => {
                  setSelectingNetwork(true);
                }}
              >
                <ArrowsRightLeftIcon className="h-4 w-4" /> <span>Switch Network</span>
              </button>
            </li>
          ) : null}
          <li className={selectingNetwork ? "hidden" : ""}>
            <button
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-destructive hover:bg-muted transition-colors"
              type="button"
              onClick={() => disconnect()}
            >
              <ArrowLeftIcon className="h-4 w-4" /> <span>Disconnect</span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
};
