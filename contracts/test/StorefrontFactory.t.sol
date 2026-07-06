// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {StorefrontFactory} from "../src/StorefrontFactory.sol";
import {StoreEscrow} from "../src/StoreEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract StorefrontFactoryTest is Test {
    StorefrontFactory internal factory;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal merchant = makeAddr("merchant");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant LAUNCH_FEE = 0.01 ether;
    uint256 internal constant PRICE = 0.5 ether;
    bytes32 internal constant PUBKEY = bytes32(uint256(0xABCD));
    bytes32 internal constant SCHEMA_HASH = keccak256("schema-v1");

    function setUp() public {
        factory = new StorefrontFactory(owner, treasury, LAUNCH_FEE);
        usdc = new MockUSDC();
        vm.prank(owner);
        factory.setTokenAllowed(address(usdc), true);
        vm.deal(merchant, 10 ether);
    }

    // ---- constructor ----

    function test_constructor_setsConfig() public view {
        assertEq(factory.owner(), owner);
        assertEq(factory.treasury(), treasury);
        assertEq(factory.launchFee(), LAUNCH_FEE);
    }

    function test_constructor_rejectsZeroTreasury() public {
        vm.expectRevert(StorefrontFactory.ZeroAddress.selector);
        new StorefrontFactory(owner, address(0), LAUNCH_FEE);
    }

    // ---- deployStore ----

    function test_deployStore_ethStore() public {
        vm.prank(merchant);
        address store = factory.deployStore{value: LAUNCH_FEE}(merchant, address(0), PRICE, PUBKEY, SCHEMA_HASH);

        StoreEscrow escrow = StoreEscrow(payable(store));
        assertEq(escrow.merchant(), merchant);
        assertEq(escrow.paymentToken(), address(0));
        assertEq(escrow.price(), PRICE);
        assertEq(escrow.merchantPubKey(), PUBKEY);
        assertEq(escrow.fulfillmentSchemaHash(), SCHEMA_HASH);
        assertEq(escrow.factory(), address(factory));

        assertEq(treasury.balance, LAUNCH_FEE);
        assertEq(factory.storeCount(merchant), 1);
        assertEq(factory.getStores(merchant)[0], store);
    }

    function test_deployStore_emitsStoreDeployed() public {
        // The store address isn't known before the call; check every field but that one.
        vm.expectEmit(true, false, true, true);
        emit StorefrontFactory.StoreDeployed(merchant, address(0), address(0), PRICE, PUBKEY, SCHEMA_HASH);
        vm.prank(merchant);
        factory.deployStore{value: LAUNCH_FEE}(merchant, address(0), PRICE, PUBKEY, SCHEMA_HASH);
    }

    function test_deployStore_usdcStore() public {
        vm.prank(merchant);
        address store = factory.deployStore{value: LAUNCH_FEE}(merchant, address(usdc), PRICE, PUBKEY, SCHEMA_HASH);
        assertEq(StoreEscrow(payable(store)).paymentToken(), address(usdc));
    }

    function test_deployStore_rejectsUnderpaidFee() public {
        vm.prank(merchant);
        vm.expectRevert(StorefrontFactory.InsufficientFee.selector);
        factory.deployStore{value: LAUNCH_FEE - 1}(merchant, address(0), PRICE, PUBKEY, SCHEMA_HASH);
    }

    function test_deployStore_forwardsExcessToTreasury() public {
        vm.prank(merchant);
        factory.deployStore{value: LAUNCH_FEE * 3}(merchant, address(0), PRICE, PUBKEY, SCHEMA_HASH);
        assertEq(treasury.balance, LAUNCH_FEE * 3);
        assertEq(address(factory).balance, 0);
    }

    function test_deployStore_rejectsNonAllowlistedToken() public {
        MockUSDC rogue = new MockUSDC();
        vm.prank(merchant);
        vm.expectRevert(StorefrontFactory.TokenNotAllowed.selector);
        factory.deployStore{value: LAUNCH_FEE}(merchant, address(rogue), PRICE, PUBKEY, SCHEMA_HASH);
    }

    function test_deployStore_merchantMayDifferFromCaller() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        address store = factory.deployStore{value: LAUNCH_FEE}(merchant, address(0), PRICE, PUBKEY, SCHEMA_HASH);
        assertEq(StoreEscrow(payable(store)).merchant(), merchant);
        assertEq(factory.storeCount(merchant), 1);
        assertEq(factory.storeCount(stranger), 0);
    }

    function test_deployStore_registryAccumulates() public {
        vm.startPrank(merchant);
        address a = factory.deployStore{value: LAUNCH_FEE}(merchant, address(0), PRICE, PUBKEY, SCHEMA_HASH);
        address b = factory.deployStore{value: LAUNCH_FEE}(merchant, address(usdc), PRICE, PUBKEY, SCHEMA_HASH);
        vm.stopPrank();
        address[] memory stores = factory.getStores(merchant);
        assertEq(stores.length, 2);
        assertEq(stores[0], a);
        assertEq(stores[1], b);
    }

    // ---- owner setters ----

    function test_setLaunchFee_appliesToFutureDeploysOnly() public {
        vm.expectEmit(true, true, true, true);
        emit StorefrontFactory.LaunchFeeChanged(LAUNCH_FEE, 0.02 ether);
        vm.prank(owner);
        factory.setLaunchFee(0.02 ether);

        vm.startPrank(merchant);
        vm.expectRevert(StorefrontFactory.InsufficientFee.selector);
        factory.deployStore{value: LAUNCH_FEE}(merchant, address(0), PRICE, PUBKEY, SCHEMA_HASH);
        factory.deployStore{value: 0.02 ether}(merchant, address(0), PRICE, PUBKEY, SCHEMA_HASH);
        vm.stopPrank();
    }

    function test_setLaunchFee_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.setLaunchFee(0);
    }

    function test_setTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        vm.expectEmit(true, true, true, true);
        emit StorefrontFactory.TreasuryChanged(treasury, newTreasury);
        vm.prank(owner);
        factory.setTreasury(newTreasury);
        assertEq(factory.treasury(), newTreasury);

        vm.prank(merchant);
        factory.deployStore{value: LAUNCH_FEE}(merchant, address(0), PRICE, PUBKEY, SCHEMA_HASH);
        assertEq(newTreasury.balance, LAUNCH_FEE);
    }

    function test_setTreasury_rejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(StorefrontFactory.ZeroAddress.selector);
        factory.setTreasury(address(0));
    }

    function test_setTreasury_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.setTreasury(stranger);
    }

    function test_setTokenAllowed_toggleAndEvents() public {
        MockUSDC other = new MockUSDC();
        vm.expectEmit(true, true, true, true);
        emit StorefrontFactory.TokenAllowlistChanged(address(other), true);
        vm.prank(owner);
        factory.setTokenAllowed(address(other), true);
        assertTrue(factory.allowedTokens(address(other)));

        vm.prank(owner);
        factory.setTokenAllowed(address(other), false);
        assertFalse(factory.allowedTokens(address(other)));

        vm.prank(merchant);
        vm.expectRevert(StorefrontFactory.TokenNotAllowed.selector);
        factory.deployStore{value: LAUNCH_FEE}(merchant, address(other), PRICE, PUBKEY, SCHEMA_HASH);
    }

    function test_setTokenAllowed_rejectsZeroAddress() public {
        // address(0) is the ETH sentinel; it must never enter the ERC-20 allowlist.
        vm.prank(owner);
        vm.expectRevert(StorefrontFactory.ZeroAddress.selector);
        factory.setTokenAllowed(address(0), true);
    }

    function test_setTokenAllowed_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.setTokenAllowed(address(usdc), false);
    }
}
