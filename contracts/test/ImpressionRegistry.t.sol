// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../ImpressionRegistry.sol";

contract ImpressionRegistryTest is Test {
    ImpressionRegistry public registry;
    address public operator = address(0x1);
    address public nonOperator = address(0x2);

    event BatchAnchored(
        uint256 indexed batchId,
        bytes32 indexed root,
        uint256 impressionCount,
        uint256 totalPayoutUsdc,
        uint256 timestamp
    );

    function setUp() public {
        registry = new ImpressionRegistry(operator);
    }

    function testOnlyOperatorCanAnchor() public {
        bytes32 root = keccak256(abi.encodePacked("test-root"));
        
        // Non-operator trying to anchor should revert
        vm.prank(nonOperator);
        vm.expectRevert("not operator");
        registry.anchor(root, 10, 100);

        // Operator should successfully anchor
        vm.prank(operator);
        uint256 batchId = registry.anchor(root, 10, 100);
        assertEq(batchId, 1);
    }

    function testAnchorEmitsEvent() public {
        bytes32 root = keccak256(abi.encodePacked("test-event-root"));
        
        vm.prank(operator);
        vm.expectEmit(true, true, false, true);
        emit BatchAnchored(1, root, 15, 150, block.timestamp);
        
        registry.anchor(root, 15, 150);
    }

    function testVerifyLeafValidProof() public {
        // Prepare some dummy leaves
        bytes32 leaf1 = keccak256(abi.encodePacked("leaf1"));
        bytes32 leaf2 = keccak256(abi.encodePacked("leaf2"));
        
        // Compute parent node
        bytes32 root = leaf1 < leaf2 
            ? keccak256(abi.encodePacked(leaf1, leaf2)) 
            : keccak256(abi.encodePacked(leaf2, leaf1));

        vm.prank(operator);
        uint256 batchId = registry.anchor(root, 2, 20);

        // Construct proof for leaf1 (the sibling is leaf2)
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leaf2;

        bool result = registry.verifyLeaf(batchId, leaf1, proof);
        assertTrue(result, "Proof verification should succeed for valid proof");
    }

    function testVerifyLeafRejectsBadProof() public {
        bytes32 leaf1 = keccak256(abi.encodePacked("leaf1"));
        bytes32 leaf2 = keccak256(abi.encodePacked("leaf2"));
        bytes32 root = leaf1 < leaf2 
            ? keccak256(abi.encodePacked(leaf1, leaf2)) 
            : keccak256(abi.encodePacked(leaf2, leaf1));

        vm.prank(operator);
        uint256 batchId = registry.anchor(root, 2, 20);

        // Provide a wrong sibling proof
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = keccak256(abi.encodePacked("wrong-leaf"));

        bool result = registry.verifyLeaf(batchId, leaf1, proof);
        assertFalse(result, "Proof verification should fail for invalid proof");
    }
}
