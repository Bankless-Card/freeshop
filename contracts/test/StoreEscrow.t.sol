// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {StoreEscrow} from "../src/StoreEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {FeeOnTransferToken, FalseReturnToken} from "./mocks/MisbehavingTokens.sol";
import {ToggleBuyer, ReentrantBuyer} from "./mocks/Buyers.sol";

contract StoreEscrowEthTest is Test {
    StoreEscrow internal store;

    address internal merchant = makeAddr("merchant");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant PRICE = 0.5 ether;
    bytes32 internal constant PUBKEY = bytes32(uint256(0xABCD));
    bytes32 internal constant SCHEMA_HASH = keccak256("schema-v1");
    bytes internal constant BLOB = hex"01deadbeef";

    function setUp() public {
        store = new StoreEscrow(merchant, address(0), PRICE, PUBKEY, SCHEMA_HASH);
        vm.deal(buyer, 100 ether);
    }

    // ---- constructor ----

    function test_constructor_setsImmutableConfig() public view {
        assertEq(store.merchant(), merchant);
        assertEq(store.paymentToken(), address(0));
        assertEq(store.price(), PRICE);
        assertEq(store.merchantPubKey(), PUBKEY);
        assertEq(store.fulfillmentSchemaHash(), SCHEMA_HASH);
        assertEq(store.factory(), address(this));
        assertEq(store.orderCount(), 0);
    }

    function test_constructor_rejectsZeroMerchant() public {
        vm.expectRevert(StoreEscrow.ZeroAddress.selector);
        new StoreEscrow(address(0), address(0), PRICE, PUBKEY, SCHEMA_HASH);
    }

    function test_constructor_rejectsZeroPrice() public {
        vm.expectRevert(StoreEscrow.ZeroPrice.selector);
        new StoreEscrow(merchant, address(0), 0, PUBKEY, SCHEMA_HASH);
    }

    function test_constructor_rejectsZeroPubKey() public {
        vm.expectRevert(StoreEscrow.ZeroPubKey.selector);
        new StoreEscrow(merchant, address(0), PRICE, bytes32(0), SCHEMA_HASH);
    }

    // ---- pay ----

    function test_pay_createsOrderAndEmitsBlob() public {
        vm.expectEmit(true, true, true, true);
        emit StoreEscrow.OrderPlaced(1, buyer, PRICE, address(0), BLOB);
        vm.prank(buyer);
        uint256 orderId = store.pay{value: PRICE}(BLOB);

        assertEq(orderId, 1);
        (address orderBuyer, uint256 amount, StoreEscrow.Status status) = store.orders(1);
        assertEq(orderBuyer, buyer);
        assertEq(amount, PRICE);
        assertEq(uint8(status), uint8(StoreEscrow.Status.PAID));
        assertEq(address(store).balance, PRICE);
        assertEq(store.availableBalance(), PRICE);
    }

    function test_pay_incrementsOrderIds() public {
        vm.startPrank(buyer);
        assertEq(store.pay{value: PRICE}(BLOB), 1);
        assertEq(store.pay{value: PRICE}(BLOB), 2);
        assertEq(store.pay{value: PRICE}(BLOB), 3);
        vm.stopPrank();
        assertEq(store.orderCount(), 3);
    }

    function testFuzz_pay_rejectsWrongValue(uint256 value) public {
        value = bound(value, 0, 10 ether);
        vm.assume(value != PRICE);
        vm.prank(buyer);
        vm.expectRevert(StoreEscrow.WrongPayment.selector);
        store.pay{value: value}(BLOB);
    }

    // ---- setStatus ----

    function test_setStatus_paidToFulfilled() public {
        uint256 orderId = _buy();
        vm.expectEmit(true, true, true, true);
        emit StoreEscrow.StatusChanged(orderId, StoreEscrow.Status.PAID, StoreEscrow.Status.FULFILLED);
        vm.prank(merchant);
        store.setStatus(orderId, StoreEscrow.Status.FULFILLED);
        assertEq(uint8(_status(orderId)), uint8(StoreEscrow.Status.FULFILLED));
    }

    function test_setStatus_paidToCancelled() public {
        uint256 orderId = _buy();
        vm.prank(merchant);
        store.setStatus(orderId, StoreEscrow.Status.CANCELLED);
        assertEq(uint8(_status(orderId)), uint8(StoreEscrow.Status.CANCELLED));
    }

    function test_setStatus_onlyMerchant() public {
        uint256 orderId = _buy();
        vm.prank(stranger);
        vm.expectRevert(StoreEscrow.NotMerchant.selector);
        store.setStatus(orderId, StoreEscrow.Status.FULFILLED);
    }

    function test_setStatus_rejectsNonexistentOrder() public {
        vm.prank(merchant);
        vm.expectRevert(StoreEscrow.InvalidTransition.selector);
        store.setStatus(42, StoreEscrow.Status.FULFILLED);
    }

    function test_setStatus_rejectsRefundedTarget() public {
        uint256 orderId = _buy();
        vm.prank(merchant);
        vm.expectRevert(StoreEscrow.InvalidTransition.selector);
        store.setStatus(orderId, StoreEscrow.Status.REFUNDED);
    }

    function test_setStatus_rejectsLeavingTerminalStatus() public {
        uint256 orderId = _buy();
        vm.startPrank(merchant);
        store.setStatus(orderId, StoreEscrow.Status.FULFILLED);
        vm.expectRevert(StoreEscrow.InvalidTransition.selector);
        store.setStatus(orderId, StoreEscrow.Status.CANCELLED);
        vm.stopPrank();
    }

    // ---- refund ----

    function test_refund_paidOrder_pushesEthToBuyer() public {
        uint256 orderId = _buy();
        uint256 balanceBefore = buyer.balance;

        vm.expectEmit(true, true, true, true);
        emit StoreEscrow.StatusChanged(orderId, StoreEscrow.Status.PAID, StoreEscrow.Status.REFUNDED);
        vm.expectEmit(true, true, true, true);
        emit StoreEscrow.Refunded(orderId, buyer, PRICE);
        vm.prank(merchant);
        store.refund(orderId);

        assertEq(buyer.balance, balanceBefore + PRICE);
        assertEq(uint8(_status(orderId)), uint8(StoreEscrow.Status.REFUNDED));
        assertEq(store.totalRefundLiability(), 0);
    }

    function test_refund_allowedAfterFulfilled() public {
        uint256 orderId = _buy();
        vm.startPrank(merchant);
        store.setStatus(orderId, StoreEscrow.Status.FULFILLED);
        store.refund(orderId);
        vm.stopPrank();
        assertEq(uint8(_status(orderId)), uint8(StoreEscrow.Status.REFUNDED));
    }

    function test_refund_allowedAfterCancelled() public {
        uint256 orderId = _buy();
        vm.startPrank(merchant);
        store.setStatus(orderId, StoreEscrow.Status.CANCELLED);
        store.refund(orderId);
        vm.stopPrank();
        assertEq(uint8(_status(orderId)), uint8(StoreEscrow.Status.REFUNDED));
    }

    function test_refund_rejectsDoubleRefund() public {
        uint256 orderId = _buy();
        vm.startPrank(merchant);
        store.refund(orderId);
        vm.expectRevert(StoreEscrow.NotRefundable.selector);
        store.refund(orderId);
        vm.stopPrank();
    }

    function test_refund_rejectsNonexistentOrder() public {
        vm.prank(merchant);
        vm.expectRevert(StoreEscrow.NotRefundable.selector);
        store.refund(42);
    }

    function test_refund_onlyMerchant() public {
        uint256 orderId = _buy();
        vm.prank(buyer);
        vm.expectRevert(StoreEscrow.NotMerchant.selector);
        store.refund(orderId);
    }

    function test_refund_revertsWhenBalanceWithdrawn() public {
        uint256 orderId = _buy();
        store.withdraw();
        vm.prank(merchant);
        vm.expectRevert(StoreEscrow.InsufficientEscrowBalance.selector);
        store.refund(orderId);
    }

    function test_refund_afterMerchantTopUp() public {
        uint256 orderId = _buy();
        store.withdraw();

        vm.deal(merchant, PRICE);
        vm.prank(merchant);
        (bool ok,) = address(store).call{value: PRICE}("");
        assertTrue(ok);

        vm.prank(merchant);
        store.refund(orderId);
        assertEq(uint8(_status(orderId)), uint8(StoreEscrow.Status.REFUNDED));
    }

    // ---- push-with-pull-fallback ----

    function test_refund_hostileRecipient_queuesForClaim() public {
        ToggleBuyer hostile = new ToggleBuyer();
        vm.deal(address(this), PRICE);
        uint256 orderId = hostile.buy{value: PRICE}(store, BLOB);

        vm.expectEmit(true, true, true, true);
        emit StoreEscrow.RefundQueued(orderId, address(hostile), PRICE);
        vm.prank(merchant);
        store.refund(orderId);

        assertEq(uint8(_status(orderId)), uint8(StoreEscrow.Status.REFUNDED));
        assertEq(store.pendingRefunds(address(hostile)), PRICE);
        assertEq(store.totalRefundLiability(), PRICE);
        assertEq(address(store).balance, PRICE);
        assertEq(store.availableBalance(), 0);
    }

    function test_claimRefund_succeedsOnceRecipientAccepts() public {
        ToggleBuyer hostile = new ToggleBuyer();
        vm.deal(address(this), PRICE);
        uint256 orderId = hostile.buy{value: PRICE}(store, BLOB);
        vm.prank(merchant);
        store.refund(orderId);

        // Still rejecting ETH: the claim's send fails and the whole claim reverts.
        vm.expectRevert();
        hostile.claim(store);

        hostile.setAcceptEth(true);
        vm.expectEmit(true, true, true, true);
        emit StoreEscrow.RefundClaimed(address(hostile), PRICE);
        hostile.claim(store);

        assertEq(address(hostile).balance, PRICE);
        assertEq(store.pendingRefunds(address(hostile)), 0);
        assertEq(store.totalRefundLiability(), 0);
    }

    function test_claimRefund_rejectsWhenNothingQueued() public {
        vm.prank(buyer);
        vm.expectRevert(StoreEscrow.NothingToClaim.selector);
        store.claimRefund();
    }

    function test_refund_reentrantBuyer_isBlockedAndQueued() public {
        ReentrantBuyer attacker = new ReentrantBuyer(store);
        vm.deal(address(this), PRICE);
        uint256 orderId = attacker.buy{value: PRICE}(BLOB);

        vm.prank(merchant);
        store.refund(orderId);

        // The reentrant withdraw() reverted inside the attacker's receive, so the push failed
        // and the refund was queued instead — funds never left through the reentrant path.
        assertEq(store.pendingRefunds(address(attacker)), PRICE);
        assertEq(address(attacker).balance, 0);
        assertEq(address(store).balance, PRICE);
    }

    // ---- withdraw ----

    function test_withdraw_paysMerchantNotCaller() public {
        _buy();
        _buy();
        uint256 merchantBefore = merchant.balance;
        uint256 strangerBefore = stranger.balance;

        vm.expectEmit(true, true, true, true);
        emit StoreEscrow.Withdrawn(stranger, 2 * PRICE);
        vm.prank(stranger);
        store.withdraw();

        assertEq(merchant.balance, merchantBefore + 2 * PRICE);
        assertEq(stranger.balance, strangerBefore);
        assertEq(address(store).balance, 0);
    }

    function test_withdraw_rejectsWhenEmpty() public {
        vm.expectRevert(StoreEscrow.NothingToWithdraw.selector);
        store.withdraw();
    }

    function test_withdraw_neverTouchesRefundLiability() public {
        ToggleBuyer hostile = new ToggleBuyer();
        vm.deal(address(this), PRICE);
        uint256 hostileOrder = hostile.buy{value: PRICE}(store, BLOB);
        _buy(); // second order stays merchant-withdrawable

        vm.prank(merchant);
        store.refund(hostileOrder); // queued: liability = PRICE

        uint256 merchantBefore = merchant.balance;
        store.withdraw();
        assertEq(merchant.balance, merchantBefore + PRICE); // only the non-liability half
        assertEq(address(store).balance, PRICE); // queued refund stays reserved

        hostile.setAcceptEth(true);
        hostile.claim(store);
        assertEq(address(hostile).balance, PRICE);
    }

    // ---- receive ----

    function test_receive_acceptsEthForEthStore() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(store).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(store).balance, 1 ether);
    }

    // ---- helpers ----

    function _buy() internal returns (uint256 orderId) {
        vm.prank(buyer);
        orderId = store.pay{value: PRICE}(BLOB);
    }

    function _status(uint256 orderId) internal view returns (StoreEscrow.Status status) {
        (,, status) = store.orders(orderId);
    }
}

contract StoreEscrowUsdcTest is Test {
    StoreEscrow internal store;
    MockUSDC internal usdc;

    address internal merchant = makeAddr("merchant");
    address internal buyer = makeAddr("buyer");

    uint256 internal constant PRICE = 25_000_000; // 25 USDC (6 decimals)
    bytes32 internal constant PUBKEY = bytes32(uint256(0xABCD));
    bytes32 internal constant SCHEMA_HASH = keccak256("schema-v1");
    bytes internal constant BLOB = hex"01deadbeef";

    function setUp() public {
        usdc = new MockUSDC();
        store = new StoreEscrow(merchant, address(usdc), PRICE, PUBKEY, SCHEMA_HASH);
        usdc.mint(buyer, 1_000_000_000);
    }

    function test_pay_pullsApprovedTokens() public {
        vm.startPrank(buyer);
        usdc.approve(address(store), PRICE);
        vm.expectEmit(true, true, true, true);
        emit StoreEscrow.OrderPlaced(1, buyer, PRICE, address(usdc), BLOB);
        uint256 orderId = store.pay(BLOB);
        vm.stopPrank();

        assertEq(orderId, 1);
        assertEq(usdc.balanceOf(address(store)), PRICE);
        assertEq(store.availableBalance(), PRICE);
    }

    function test_pay_rejectsWithoutApproval() public {
        vm.prank(buyer);
        vm.expectRevert();
        store.pay(BLOB);
    }

    function test_pay_rejectsAttachedEth() public {
        vm.deal(buyer, 1 ether);
        vm.startPrank(buyer);
        usdc.approve(address(store), PRICE);
        vm.expectRevert(StoreEscrow.WrongPayment.selector);
        store.pay{value: 1 wei}(BLOB);
        vm.stopPrank();
    }

    function test_refund_pushesTokensToBuyer() public {
        uint256 orderId = _buy();
        uint256 balanceBefore = usdc.balanceOf(buyer);
        vm.prank(merchant);
        store.refund(orderId);
        assertEq(usdc.balanceOf(buyer), balanceBefore + PRICE);
        assertEq(usdc.balanceOf(address(store)), 0);
    }

    function test_withdraw_paysMerchantInTokens() public {
        _buy();
        _buy();
        vm.prank(buyer); // anyone may call; merchant still gets paid
        store.withdraw();
        assertEq(usdc.balanceOf(merchant), 2 * PRICE);
        assertEq(usdc.balanceOf(address(store)), 0);
    }

    function test_receive_rejectsEthForTokenStore() public {
        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        (bool ok,) = address(store).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_pay_rejectsFeeOnTransferToken() public {
        FeeOnTransferToken feeToken = new FeeOnTransferToken();
        StoreEscrow feeStore = new StoreEscrow(merchant, address(feeToken), PRICE, PUBKEY, SCHEMA_HASH);
        feeToken.mint(buyer, PRICE * 2);

        vm.startPrank(buyer);
        feeToken.approve(address(feeStore), PRICE);
        vm.expectRevert(StoreEscrow.UnsupportedToken.selector);
        feeStore.pay(BLOB);
        vm.stopPrank();
    }

    function test_pay_rejectsFalseReturnToken() public {
        FalseReturnToken falseToken = new FalseReturnToken();
        StoreEscrow falseStore = new StoreEscrow(merchant, address(falseToken), PRICE, PUBKEY, SCHEMA_HASH);
        falseToken.mint(buyer, PRICE * 2);

        vm.startPrank(buyer);
        falseToken.approve(address(falseStore), PRICE);
        vm.expectRevert(); // SafeERC20 catches the false return
        falseStore.pay(BLOB);
        vm.stopPrank();
    }

    function _buy() internal returns (uint256 orderId) {
        vm.startPrank(buyer);
        usdc.approve(address(store), PRICE);
        orderId = store.pay(BLOB);
        vm.stopPrank();
    }
}
