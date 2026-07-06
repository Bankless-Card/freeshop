// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {StoreEscrow} from "../../src/StoreEscrow.sol";

/// @dev Contract buyer whose willingness to receive ETH can be toggled — used to force the
///      refund push to fail and exercise the pull fallback.
contract ToggleBuyer {
    bool public acceptEth;

    function setAcceptEth(bool accept) external {
        acceptEth = accept;
    }

    function buy(StoreEscrow store, bytes calldata blob) external payable returns (uint256) {
        return store.pay{value: msg.value}(blob);
    }

    function claim(StoreEscrow store) external {
        store.claimRefund();
    }

    receive() external payable {
        require(acceptEth, "ToggleBuyer: rejecting ETH");
    }
}

/// @dev Buyer that attempts to re-enter the store when it receives ETH.
contract ReentrantBuyer {
    StoreEscrow public store;
    bool public reentered;

    constructor(StoreEscrow store_) {
        store = store_;
    }

    function buy(bytes calldata blob) external payable returns (uint256) {
        return store.pay{value: msg.value}(blob);
    }

    function claim() external {
        store.claimRefund();
    }

    receive() external payable {
        // Try to drain via withdraw during the refund push; the reentrancy guard must stop this.
        reentered = true;
        store.withdraw();
    }
}
