// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {StorefrontFactory} from "../src/StorefrontFactory.sol";

/// @notice Deploys the StorefrontFactory and allowlists USDC.
///
/// Env vars:
///   TREASURY   — launch-fee recipient (defaults to the deployer)
///   USDC       — USDC address to allowlist (defaults to Sepolia USDC)
///   LAUNCH_FEE — fee in wei (defaults to 0.01 ether)
///
/// Sepolia:
///   forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify \
///     --private-key $DEPLOYER_KEY
contract Deploy is Script {
    address internal constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external returns (StorefrontFactory factory) {
        address deployer = msg.sender;
        address treasury = vm.envOr("TREASURY", deployer);
        address usdc = vm.envOr("USDC", SEPOLIA_USDC);
        uint256 launchFee = vm.envOr("LAUNCH_FEE", uint256(0.01 ether));

        vm.startBroadcast();
        factory = new StorefrontFactory(deployer, treasury, launchFee);
        factory.setTokenAllowed(usdc, true);
        vm.stopBroadcast();

        console.log("StorefrontFactory:", address(factory));
        console.log("  owner:          ", deployer);
        console.log("  treasury:       ", treasury);
        console.log("  launchFee (wei):", launchFee);
        console.log("  USDC allowed:   ", usdc);
    }
}
