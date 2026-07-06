// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {StorefrontFactory} from "../src/StorefrontFactory.sol";
import {StoreEscrow} from "../src/StoreEscrow.sol";

/// @notice Full lifecycle smoke test against a live network (anvil or Sepolia), acting as both
///         merchant and buyer from the broadcasting key:
///         deploy factory → deploy ETH store → pay → FULFILLED → second order → refund → withdraw.
///
/// Local:
///   anvil &
///   forge script script/Smoke.s.sol --rpc-url http://localhost:8545 --broadcast \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
contract Smoke is Script {
    uint256 internal constant LAUNCH_FEE = 0.01 ether;
    uint256 internal constant PRICE = 0.001 ether;

    function run() external {
        address self = msg.sender;
        vm.startBroadcast();

        StorefrontFactory factory = new StorefrontFactory(self, self, LAUNCH_FEE);
        console.log("factory:", address(factory));

        StoreEscrow store = StoreEscrow(
            payable(
                factory.deployStore{value: LAUNCH_FEE}(
                    self, address(0), PRICE, bytes32(uint256(1)), keccak256("smoke-schema")
                )
            )
        );
        console.log("store:", address(store));
        require(factory.getStores(self).length == 1, "registry miss");

        uint256 order1 = store.pay{value: PRICE}(hex"01c0ffee");
        console.log("order 1 placed");
        store.setStatus(order1, StoreEscrow.Status.FULFILLED);
        console.log("order 1 fulfilled");

        uint256 order2 = store.pay{value: PRICE}(hex"01c0ffee");
        store.refund(order2);
        (,, StoreEscrow.Status status2) = store.orders(order2);
        require(status2 == StoreEscrow.Status.REFUNDED, "refund miss");
        console.log("order 2 refunded");

        require(store.availableBalance() == PRICE, "unexpected balance");
        store.withdraw();
        require(store.availableBalance() == 0, "withdraw miss");
        console.log("withdrawn to merchant");

        vm.stopBroadcast();
        console.log("smoke test OK");
    }
}
