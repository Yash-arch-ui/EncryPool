// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin-contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {
    ERC7984ERC20Wrapper
} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ConfidentialPrizeVault} from "../src/ConfidentialPrizeVault.sol";
import {ConfidentialPrizePool} from "../src/ConfidentialPrizePool.sol";

contract LocalUSDT is ERC20 {
    constructor() ERC20("Local USDT", "USDT") {
        _mint(msg.sender, 10_000_000e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/// @dev Local-only stand-in for cUSDT; same OZ base the production wrappers use.
contract LocalCUSDT is ZamaEthereumConfig, ERC7984ERC20Wrapper {
    constructor(IERC20 u) ZamaEthereumConfig() ERC7984("cUSDT", "cUSDT", "") ERC7984ERC20Wrapper(u) {}
}

contract DeployConfidentialPrizeVault is Script {
    /// @dev Official Zama confidential USDT wrapper on Sepolia, as listed in the
    /// Confidential Token Wrappers Registry (registry 0x2f0750Bbb0A246059d80e94c454586a7F27a128e,
    /// underlying mock USDT 0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0):
    address constant SEPOLIA_CUSDT = 0x4E7B06D78965594eB5EF5414c357ca21E1554491;

    function run() external returns (ConfidentialPrizeVault vault, ConfidentialPrizePool prizePool) {
        IERC7984 asset;
        if (block.chainid == 11155111) {
            asset = IERC7984(SEPOLIA_CUSDT);
        } else if (block.chainid == 31337) {
            vm.startBroadcast();
            LocalUSDT usdt = new LocalUSDT();
            LocalCUSDT cusdt = new LocalCUSDT(IERC20(address(usdt)));
            // Pre-wrap a working balance for the broadcaster so the dev loop can deposit.
            usdt.approve(address(cusdt), 100_000e6);
            cusdt.wrap(msg.sender, 100_000e6);
            vm.stopBroadcast();
            asset = cusdt;
        } else {
            revert("UnsupportedChain");
        }

        vm.startBroadcast();
        vault = new ConfidentialPrizeVault(asset);
        prizePool = new ConfidentialPrizePool(asset, vault, vault.balanceTracker());
        vault.setPrizePool(address(prizePool));
        vm.stopBroadcast();

        console.log("asset (confidential token):", address(asset));
        console.log("ConfidentialPrizeVault:", address(vault));
        console.log("ConfidentialPrizePool:", address(prizePool));
        console.log("EncryptedBalanceTracker:", address(vault.balanceTracker()));
    }
}
