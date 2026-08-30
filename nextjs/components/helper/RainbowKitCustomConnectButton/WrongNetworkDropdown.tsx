import { useRef, useState } from "react";
import { NetworkOptions } from "./NetworkOptions";
import { useDisconnect } from "wagmi";
import { ArrowLeftOnRectangleIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { useOutsideClick } from "~~/hooks/helper";

export const WrongNetworkDropdown = () => {
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useOutsideClick(dropdownRef, () => setOpen(false));

  return (
    <div ref={dropdownRef} className="relative mr-2">
      <button
        className="flex items-center gap-1 rounded-full border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-bold text-destructive transition-colors hover:bg-destructive/20"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span>Wrong network</span>
        <ChevronDownIcon className="h-4 w-4 ml-2" />
      </button>
      {open && (
        <ul className="absolute right-0 z-20 mt-1 min-w-[200px] rounded-xl border border-border bg-card p-2 shadow-xl gap-1 flex flex-col">
          <NetworkOptions />
          <li>
            <button
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-destructive hover:bg-muted transition-colors"
              type="button"
              onClick={() => disconnect()}
            >
              <ArrowLeftOnRectangleIcon className="h-4 w-4" />
              <span>Disconnect</span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
};
