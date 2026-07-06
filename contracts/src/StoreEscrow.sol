// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @title StoreEscrow — per-product payment/escrow contract
/// @notice Sells a single product at a fixed price in a single asset (native ETH or one ERC-20).
///         Buyer fulfillment data is encrypted client-side to `merchantPubKey` (x25519) and emitted
///         in the `pay` transaction as event data — never kept in contract storage.
///         Proceeds accrue in the contract (so refunds stay payable) until `withdraw()` sends them
///         to the immutable `merchant`.
contract StoreEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        NONE, // order does not exist
        PAID,
        FULFILLED,
        CANCELLED,
        REFUNDED
    }

    struct Order {
        address buyer;
        uint256 amount;
        Status status;
    }

    /// @notice Payout recipient and owner of merchant-only actions. Immutable by design (v1: no rotation).
    address public immutable merchant;
    /// @notice Payment asset. address(0) is the native-ETH sentinel; otherwise a factory-whitelisted ERC-20.
    address public immutable paymentToken;
    uint256 public immutable price;
    /// @notice x25519 public key buyers encrypt fulfillment payloads to. The merchant re-derives the
    ///         matching private key from a wallet signature; the platform never sees plaintext.
    bytes32 public immutable merchantPubKey;
    /// @notice Commitment to the fulfillment-field schema the storefront renders.
    bytes32 public immutable fulfillmentSchemaHash;
    address public immutable factory;

    /// @notice Total orders ever placed; order ids are 1..orderCount.
    uint256 public orderCount;
    mapping(uint256 orderId => Order) public orders;
    /// @notice Refunds that could not be pushed (reverting ETH recipient) awaiting buyer claim.
    mapping(address buyer => uint256) public pendingRefunds;
    /// @notice Sum of all unclaimed pendingRefunds — carved out of the merchant-withdrawable balance.
    uint256 public totalRefundLiability;

    event OrderPlaced(
        uint256 indexed orderId, address indexed buyer, uint256 amount, address paymentToken, bytes encryptedFulfillment
    );
    event StatusChanged(uint256 indexed orderId, Status oldStatus, Status newStatus);
    event Refunded(uint256 indexed orderId, address indexed buyer, uint256 amount);
    event RefundQueued(uint256 indexed orderId, address indexed buyer, uint256 amount);
    event RefundClaimed(address indexed buyer, uint256 amount);
    event Withdrawn(address indexed caller, uint256 amount);

    error NotMerchant();
    error ZeroAddress();
    error ZeroPrice();
    error ZeroPubKey();
    error WrongPayment();
    error UnsupportedToken();
    error InvalidTransition();
    error NotRefundable();
    error InsufficientEscrowBalance();
    error NothingToClaim();
    error NothingToWithdraw();
    error EthNotAccepted();

    modifier onlyMerchant() {
        if (msg.sender != merchant) revert NotMerchant();
        _;
    }

    constructor(
        address merchant_,
        address paymentToken_,
        uint256 price_,
        bytes32 merchantPubKey_,
        bytes32 fulfillmentSchemaHash_
    ) {
        if (merchant_ == address(0)) revert ZeroAddress();
        if (price_ == 0) revert ZeroPrice();
        if (merchantPubKey_ == bytes32(0)) revert ZeroPubKey();
        merchant = merchant_;
        // slither-disable-next-line missing-zero-check -- address(0) is the native-ETH sentinel
        paymentToken = paymentToken_;
        price = price_;
        merchantPubKey = merchantPubKey_;
        fulfillmentSchemaHash = fulfillmentSchemaHash_;
        factory = msg.sender;
    }

    /// @notice Buy the product. ETH stores: send exactly `price` as value. ERC-20 stores: approve
    ///         `price` first and send no value. `encryptedFulfillment` is the buyer's fulfillment
    ///         data encrypted to `merchantPubKey`; it is emitted, not stored.
    function pay(bytes calldata encryptedFulfillment) external payable nonReentrant returns (uint256 orderId) {
        orderId = ++orderCount;
        orders[orderId] = Order({buyer: msg.sender, amount: price, status: Status.PAID});
        emit OrderPlaced(orderId, msg.sender, price, paymentToken, encryptedFulfillment);

        if (paymentToken == address(0)) {
            if (msg.value != price) revert WrongPayment();
        } else {
            if (msg.value != 0) revert WrongPayment();
            IERC20 token = IERC20(paymentToken);
            uint256 balanceBefore = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), price);
            // Whitelisting should already exclude fee-on-transfer tokens; enforce it anyway.
            if (token.balanceOf(address(this)) - balanceBefore != price) revert UnsupportedToken();
        }
    }

    /// @notice Merchant-only fulfillment bookkeeping. Refunds go through `refund()`, never here.
    function setStatus(uint256 orderId, Status newStatus) external onlyMerchant {
        Order storage order = orders[orderId];
        if (order.status != Status.PAID) revert InvalidTransition();
        if (newStatus != Status.FULFILLED && newStatus != Status.CANCELLED) revert InvalidTransition();
        emit StatusChanged(orderId, order.status, newStatus);
        order.status = newStatus;
    }

    /// @notice Full refund of one order, merchant-only, allowed from any status except REFUNDED —
    ///         including after FULFILLED. ETH refunds are pushed to the buyer; if the push reverts,
    ///         the amount is credited for the buyer to `claimRefund()` so a hostile recipient cannot
    ///         make their order permanently unrefundable.
    function refund(uint256 orderId) external nonReentrant onlyMerchant {
        Order storage order = orders[orderId];
        if (order.status == Status.NONE || order.status == Status.REFUNDED) revert NotRefundable();
        uint256 amount = order.amount;
        if (availableBalance() < amount) revert InsufficientEscrowBalance();

        emit StatusChanged(orderId, order.status, Status.REFUNDED);
        order.status = Status.REFUNDED;
        emit Refunded(orderId, order.buyer, amount);

        if (paymentToken == address(0)) {
            // The fallback credit can only happen after the push is attempted, so these writes
            // necessarily follow the external call; every mutating entry point shares the
            // reentrancy guard, so the buyer's receive() cannot re-enter around them.
            // slither-disable-start reentrancy-eth,reentrancy-benign,low-level-calls
            (bool ok,) = order.buyer.call{value: amount}("");
            if (!ok) {
                pendingRefunds[order.buyer] += amount;
                totalRefundLiability += amount;
                emit RefundQueued(orderId, order.buyer, amount);
            }
            // slither-disable-end reentrancy-eth,reentrancy-benign,low-level-calls
        } else {
            IERC20(paymentToken).safeTransfer(order.buyer, amount);
        }
    }

    /// @notice Buyer claims refunds that could not be pushed.
    function claimRefund() external nonReentrant {
        uint256 amount = pendingRefunds[msg.sender];
        if (amount == 0) revert NothingToClaim();
        pendingRefunds[msg.sender] = 0;
        totalRefundLiability -= amount;
        emit RefundClaimed(msg.sender, amount);
        Address.sendValue(payable(msg.sender), amount);
    }

    /// @notice Sends the store's withdrawable balance to the immutable `merchant` — never the caller.
    ///         Callable by anyone; harmless because the destination is fixed (and this is what keeps
    ///         a future batched multi-store sweep possible without changing this contract).
    function withdraw() external nonReentrant {
        uint256 amount = availableBalance();
        // slither-disable-next-line incorrect-equality -- zero-comparison, not a balance equality
        if (amount == 0) revert NothingToWithdraw();
        emit Withdrawn(msg.sender, amount);
        if (paymentToken == address(0)) {
            Address.sendValue(payable(merchant), amount);
        } else {
            IERC20(paymentToken).safeTransfer(merchant, amount);
        }
    }

    /// @notice Balance the merchant may withdraw: holdings minus refunds owed to buyers.
    function availableBalance() public view returns (uint256) {
        uint256 balance =
            paymentToken == address(0) ? address(this).balance : IERC20(paymentToken).balanceOf(address(this));
        return balance > totalRefundLiability ? balance - totalRefundLiability : 0;
    }

    /// @notice ETH stores accept plain transfers so a merchant can top the contract back up to cover
    ///         refunds after withdrawing. ERC-20 stores reject ETH so it can never get stuck here.
    receive() external payable {
        if (paymentToken != address(0)) revert EthNotAccepted();
    }
}
