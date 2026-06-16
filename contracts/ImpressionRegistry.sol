// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ImpressionRegistry {
    address public immutable operator;
    uint256 public lastBatchId;
    mapping(uint256 => bytes32) public roots;

    event BatchAnchored(
        uint256 indexed batchId,
        bytes32 indexed root,
        uint256 impressionCount,
        uint256 totalPayoutUsdc,
        uint256 timestamp
    );

    constructor(address _op) {
        operator = _op;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    function anchor(
        bytes32 root,
        uint256 impressionCount,
        uint256 totalPayoutUsdc
    ) external onlyOperator returns (uint256 id) {
        id = ++lastBatchId;
        roots[id] = root;
        emit BatchAnchored(id, root, impressionCount, totalPayoutUsdc, block.timestamp);
    }

    function verifyLeaf(
        uint256 batchId,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        bytes32 computed = leaf;
        for (uint256 i; i < proof.length; ++i) {
            bytes32 p = proof[i];
            computed = computed < p 
                ? keccak256(abi.encodePacked(computed, p)) 
                : keccak256(abi.encodePacked(p, computed));
        }
        return computed == roots[batchId];
    }
}
