// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract MolfiAdMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum AdKind { TEXT, IMAGE, VIDEO }

    struct Campaign {
        address marketer;
        bytes32 contentCid;
        string  contentURI;
        uint256 budgetRemaining;
        uint256 rewardPerImpression;
        uint64  startTime;
        uint64  endTime;
        AdKind  kind;
        bool    active;
    }

    IERC20  public immutable usdc;
    address public serverSigner;
    address public treasury;
    uint16  public platformFeeBps = 1000;
    uint256 public nextCampaignId = 1;

    mapping(uint256 => Campaign) public campaigns;
    mapping(bytes32 => bool)     public consumedReceipt;
    mapping(address => uint256)  public pendingWithdraw;
    mapping(uint256 => uint256)  public impressionsServed;

    event CampaignCreated(uint256 indexed id, address indexed marketer, bytes32 contentCid, uint256 budget, uint256 rewardPerImpression, AdKind kind);
    event CampaignFunded (uint256 indexed id, uint256 amount, uint256 newBudget);
    event CampaignClosed (uint256 indexed id, address indexed marketer, uint256 refunded);
    event ImpressionsAnchored(bytes32 indexed merkleRoot, uint256 totalUsdc, uint256 viewerCount);
    event UserWithdrew   (address indexed user, uint256 amount);
    event ServerSignerUpdated(address indexed previous, address indexed next);

    modifier onlyServer() { require(msg.sender == serverSigner, "not server"); _; }

    constructor(address _usdc, address _serverSigner, address _treasury) Ownable(msg.sender) {
        require(_usdc != address(0) && _serverSigner != address(0) && _treasury != address(0), "zero");
        usdc = IERC20(_usdc); serverSigner = _serverSigner; treasury = _treasury;
    }

    function createCampaign(
        bytes32 contentCid, string calldata contentURI,
        uint256 budget, uint256 rewardPerImpression,
        uint64 startTime, uint64 endTime, AdKind kind
    ) external nonReentrant returns (uint256 id) {
        require(budget > 0 && rewardPerImpression > 0, "amount");
        require(rewardPerImpression <= budget, "reward>budget");
        require(endTime > startTime && endTime > block.timestamp, "time");
        id = nextCampaignId++;
        campaigns[id] = Campaign(msg.sender, contentCid, contentURI, budget, rewardPerImpression, startTime, endTime, kind, true);
        usdc.safeTransferFrom(msg.sender, address(this), budget);
        emit CampaignCreated(id, msg.sender, contentCid, budget, rewardPerImpression, kind);
    }

    function topUpCampaign(uint256 id, uint256 amount) external nonReentrant {
        Campaign storage c = campaigns[id];
        require(c.marketer == msg.sender, "owner");
        require(c.active, "closed");
        c.budgetRemaining += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit CampaignFunded(id, amount, c.budgetRemaining);
    }

    function closeCampaign(uint256 id) external nonReentrant {
        Campaign storage c = campaigns[id];
        require(c.marketer == msg.sender, "owner");
        require(c.active, "closed");
        c.active = false;
        uint256 refund = c.budgetRemaining;
        c.budgetRemaining = 0;
        if (refund > 0) usdc.safeTransfer(msg.sender, refund);
        emit CampaignClosed(id, msg.sender, refund);
    }

    function batchAnchor(
        bytes32 merkleRoot,
        bytes32[] calldata receiptIds,
        uint256[] calldata campaignIds,
        address[] calldata viewers,
        uint256[] calldata amounts
    ) external onlyServer nonReentrant {
        uint256 n = viewers.length;
        require(n == amounts.length && n == campaignIds.length && n == receiptIds.length, "len");
        uint256 totalUsdc;
        for (uint256 i; i < n; ++i) {
            bytes32 rid = receiptIds[i];
            require(!consumedReceipt[rid], "dup receipt");
            consumedReceipt[rid] = true;
            Campaign storage c = campaigns[campaignIds[i]];
            require(c.active, "campaign closed");
            require(c.budgetRemaining >= amounts[i], "budget");
            c.budgetRemaining -= amounts[i];
            impressionsServed[campaignIds[i]] += 1;
            uint256 fee = (amounts[i] * platformFeeBps) / 10000;
            uint256 net = amounts[i] - fee;
            pendingWithdraw[viewers[i]] += net;
            if (fee > 0) pendingWithdraw[treasury] += fee;
            totalUsdc += amounts[i];
        }
        emit ImpressionsAnchored(merkleRoot, totalUsdc, n);
    }

    function userWithdraw() external nonReentrant {
        uint256 owed = pendingWithdraw[msg.sender];
        require(owed > 0, "nothing");
        pendingWithdraw[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, owed);
        emit UserWithdrew(msg.sender, owed);
    }

    function setServerSigner(address next) external onlyOwner {
        require(next != address(0), "zero");
        emit ServerSignerUpdated(serverSigner, next);
        serverSigner = next;
    }
    function setTreasury(address next) external onlyOwner { require(next != address(0), "zero"); treasury = next; }
    function setPlatformFeeBps(uint16 bps) external onlyOwner { require(bps <= 2000, "max 20%"); platformFeeBps = bps; }
}
