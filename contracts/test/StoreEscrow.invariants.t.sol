// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {StoreEscrow} from "../src/StoreEscrow.sol";
import {ToggleBuyer} from "./mocks/Buyers.sol";

/// @dev Random-walk driver for an ETH store. Ghost counters track every wei that crosses the
///      contract boundary so the invariant contract can assert conservation of funds.
contract EscrowHandler is Test {
    StoreEscrow public store;
    address public merchant;

    address[] internal eoaBuyers;
    ToggleBuyer public toggleBuyer;

    uint256 public ghostPaidIn;
    uint256 public ghostToppedUp;
    uint256 public ghostRefundedOut; // pushed refunds + claimed refunds
    uint256 public ghostWithdrawn;

    constructor(StoreEscrow store_, address merchant_) {
        store = store_;
        merchant = merchant_;
        for (uint256 i = 0; i < 4; i++) {
            eoaBuyers.push(makeAddr(string(abi.encodePacked("buyer", i))));
        }
        toggleBuyer = new ToggleBuyer();
    }

    function pay(uint256 buyerSeed) external {
        uint256 price = store.price();
        if (buyerSeed % 5 == 4) {
            vm.deal(address(this), price);
            toggleBuyer.buy{value: price}(store, hex"01");
        } else {
            address buyer = eoaBuyers[buyerSeed % 4];
            vm.deal(buyer, price);
            vm.prank(buyer);
            store.pay{value: price}(hex"01");
        }
        ghostPaidIn += price;
    }

    function setStatus(uint256 orderSeed, uint256 statusSeed) external {
        uint256 count = store.orderCount();
        if (count == 0) return;
        uint256 orderId = (orderSeed % count) + 1;
        StoreEscrow.Status target =
            statusSeed % 2 == 0 ? StoreEscrow.Status.FULFILLED : StoreEscrow.Status.CANCELLED;
        vm.prank(merchant);
        store.setStatus(orderId, target);
    }

    function toggleAcceptance(bool accept) external {
        toggleBuyer.setAcceptEth(accept);
    }

    function refund(uint256 orderSeed) external {
        uint256 count = store.orderCount();
        if (count == 0) return;
        uint256 orderId = (orderSeed % count) + 1;
        (address buyer,,) = store.orders(orderId);

        uint256 buyerBefore = buyer.balance;
        vm.prank(merchant);
        store.refund(orderId);
        // Push succeeded if the buyer balance moved; otherwise it was queued (stays in contract).
        ghostRefundedOut += buyer.balance - buyerBefore;
    }

    function claimRefund() external {
        uint256 pending = store.pendingRefunds(address(toggleBuyer));
        if (pending == 0) return;
        toggleBuyer.setAcceptEth(true);
        toggleBuyer.claim(store);
        ghostRefundedOut += pending;
    }

    function withdraw() external {
        uint256 merchantBefore = merchant.balance;
        store.withdraw();
        ghostWithdrawn += merchant.balance - merchantBefore;
    }

    function topUp(uint256 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 10 ether);
        vm.deal(address(this), amount);
        (bool ok,) = address(store).call{value: amount}("");
        require(ok, "topUp failed");
        ghostToppedUp += amount;
    }
}

contract StoreEscrowInvariantTest is Test {
    StoreEscrow internal store;
    EscrowHandler internal handler;
    address internal merchant = makeAddr("merchant");

    function setUp() public {
        store = new StoreEscrow(merchant, address(0), 0.1 ether, bytes32(uint256(1)), keccak256("schema"));
        handler = new EscrowHandler(store, merchant);
        targetContract(address(handler));
    }

    /// Queued refunds are always fully backed: the merchant can never withdraw money owed to buyers.
    function invariant_balanceCoversRefundLiability() public view {
        assertGe(address(store).balance, store.totalRefundLiability());
    }

    /// Conservation: every wei in equals every wei out plus what the contract still holds.
    function invariant_fundsConservation() public view {
        assertEq(
            handler.ghostPaidIn() + handler.ghostToppedUp(),
            handler.ghostRefundedOut() + handler.ghostWithdrawn() + address(store).balance
        );
    }

    /// Every placed order exists and holds a legal status; ids are dense from 1..orderCount.
    function invariant_orderStatusesAreLegal() public view {
        uint256 count = store.orderCount();
        for (uint256 id = 1; id <= count; id++) {
            (address buyer,, StoreEscrow.Status status) = store.orders(id);
            assertTrue(buyer != address(0));
            assertTrue(status != StoreEscrow.Status.NONE);
        }
    }
}
