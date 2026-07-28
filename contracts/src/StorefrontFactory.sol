// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {StoreEscrow} from "./StoreEscrow.sol";

/// @title StorefrontFactory — deploys per-product StoreEscrow contracts
/// @notice Charges the platform launch fee, validates the payment asset against the ERC-20
///         allowlist (native ETH is always available and never allowlisted), and keeps the
///         on-chain admin → stores registry that powers the dashboard's store list.
contract StorefrontFactory is Ownable {
    /// @notice Fee (wei) required to deploy a store. Owner-adjustable; affects future deploys only.
    uint256 public launchFee;
    /// @notice Recipient of launch fees.
    address public treasury;
    /// @notice ERC-20s stores may be denominated in. Exists to exclude misbehaving tokens
    ///         (fee-on-transfer, reentrant callbacks, non-standard returns).
    mapping(address token => bool) public allowedTokens;

    mapping(address admin => address[]) private _storesByAdmin;

    event StoreDeployed(
        address indexed admin,
        address indexed store,
        address payoutRecipient,
        address paymentToken,
        uint256 price,
        bytes32 merchantPubKey,
        bytes32 fulfillmentSchemaHash
    );
    event LaunchFeeChanged(uint256 oldFee, uint256 newFee);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event TokenAllowlistChanged(address indexed token, bool allowed);

    error InsufficientFee();
    error TokenNotAllowed();
    error ZeroAddress();

    constructor(address owner_, address treasury_, uint256 launchFee_) Ownable(owner_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        launchFee = launchFee_;
        emit TreasuryChanged(address(0), treasury_);
        emit LaunchFeeChanged(0, launchFee_);
    }

    /// @notice Deploys a StoreEscrow. The caller becomes the store's immutable `admin` — the wallet
    ///         that fulfils/refunds/withdraws and whose signature derives the decryption key; it is
    ///         never a parameter, so admin and key can't diverge. `payoutRecipient` is only where
    ///         withdrawals land (may be a cold wallet). `paymentToken` is address(0) for native ETH
    ///         or an allowlisted ERC-20. msg.value must equal launchFee exactly and is forwarded to
    ///         the treasury; the exact-match check keeps callers holding a stale fee from overpaying
    ///         after a change.
    function deployStore(
        address payoutRecipient,
        address paymentToken,
        uint256 price,
        bytes32 merchantPubKey,
        bytes32 fulfillmentSchemaHash
    ) external payable returns (address store) {
        if (msg.value != launchFee) revert InsufficientFee();
        if (paymentToken != address(0) && !allowedTokens[paymentToken]) revert TokenNotAllowed();

        store = address(
            new StoreEscrow(msg.sender, payoutRecipient, paymentToken, price, merchantPubKey, fulfillmentSchemaHash)
        );
        _storesByAdmin[msg.sender].push(store);
        emit StoreDeployed(msg.sender, store, payoutRecipient, paymentToken, price, merchantPubKey, fulfillmentSchemaHash);

        if (msg.value > 0) {
            Address.sendValue(payable(treasury), msg.value);
        }
    }

    function getStores(address admin) external view returns (address[] memory) {
        return _storesByAdmin[admin];
    }

    function storeCount(address admin) external view returns (uint256) {
        return _storesByAdmin[admin].length;
    }

    function setLaunchFee(uint256 newFee) external onlyOwner {
        emit LaunchFeeChanged(launchFee, newFee);
        launchFee = newFee;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryChanged(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        allowedTokens[token] = allowed;
        emit TokenAllowlistChanged(token, allowed);
    }
}
