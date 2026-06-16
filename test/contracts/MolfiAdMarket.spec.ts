import pkg from "hardhat";
const { viem } = pkg;
import { expect } from "chai";
import { keccak256, toBytes, encodePacked, encodeAbiParameters } from "viem";

describe("MolfiAdMarket Contract Spec Tests", () => {
  async function deployFixture() {
    const [owner, marketer, serverSigner, treasury, viewer] = await viem.getWalletClients();
    
    // Deploy MockUSDC
    const usdc = await viem.deployContract("MockUSDC", []);
    
    // Deploy MolfiAdMarket
    const market = await viem.deployContract("MolfiAdMarket", [
      usdc.address,
      serverSigner.account.address,
      treasury.account.address,
    ]);

    // Mint USDC to marketer
    const initialMarketerUsdc = 1000n * 10n**6n;
    await usdc.write.mint([marketer.account.address, initialMarketerUsdc]);
    
    // Approve market
    const marketerUsdc = await viem.getContractAt("MockUSDC", usdc.address, { client: { wallet: marketer } });
    await marketerUsdc.write.approve([market.address, initialMarketerUsdc]);

    // Connect market contract to marketer wallet
    const marketerMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: marketer } });

    return { owner, marketer, serverSigner, treasury, viewer, usdc, market, marketerUsdc, marketerMarket };
  }

  it("1. createCampaign happy path -> emits event, transfers USDC, increments id", async () => {
    const { marketer, market, usdc, marketerMarket } = await deployFixture();
    
    const budget = 100n * 10n**6n;
    const rewardPerImpression = 1n * 10n**6n;
    const startTime = BigInt(Math.floor(Date.now() / 1000) + 10);
    const endTime = startTime + 3600n;
    const contentCid = keccak256(toBytes("test-cid"));
    const contentURI = "ipfs://QmTest";
    const kind = 2; // VIDEO

    // Check balance before
    const balBefore = await usdc.read.balanceOf([marketer.account.address]);
    const marketBalBefore = await usdc.read.balanceOf([market.address]);

    // Execute createCampaign
    const hash = await marketerMarket.write.createCampaign([
      contentCid,
      contentURI,
      budget,
      rewardPerImpression,
      startTime,
      endTime,
      kind,
    ]);

    const publicClient = await viem.getPublicClient();
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    // Check balance after
    const balAfter = await usdc.read.balanceOf([marketer.account.address]);
    const marketBalAfter = await usdc.read.balanceOf([market.address]);

    expect(balBefore - balAfter).to.equal(budget);
    expect(marketBalAfter - marketBalBefore).to.equal(budget);

    // Verify campaign details in mapping
    const campaign = await market.read.campaigns([1n]);
    expect(campaign[0].toLowerCase()).to.equal(marketer.account.address.toLowerCase());
    expect(campaign[1]).to.equal(contentCid);
    expect(campaign[2]).to.equal(contentURI);
    expect(campaign[3]).to.equal(budget);
    expect(campaign[4]).to.equal(rewardPerImpression);
    expect(campaign[5]).to.equal(startTime);
    expect(campaign[6]).to.equal(endTime);
    expect(campaign[7]).to.equal(kind);
    expect(campaign[8]).to.be.true; // active

    const nextId = await market.read.nextCampaignId();
    expect(nextId).to.equal(2n);
  });

  it("2. createCampaign rejects rewardPerImpression > budget", async () => {
    const { marketerMarket } = await deployFixture();
    
    const budget = 10n * 10n**6n;
    const rewardPerImpression = 11n * 10n**6n;
    const startTime = BigInt(Math.floor(Date.now() / 1000) + 10);
    const endTime = startTime + 3600n;
    const contentCid = keccak256(toBytes("test-cid"));
    const contentURI = "ipfs://QmTest";

    await expect(
      marketerMarket.write.createCampaign([
        contentCid,
        contentURI,
        budget,
        rewardPerImpression,
        startTime,
        endTime,
        2,
      ])
    ).to.be.rejectedWith("reward>budget");
  });

  it("3. createCampaign rejects endTime <= startTime or in past", async () => {
    const { marketerMarket } = await deployFixture();
    
    const budget = 100n * 10n**6n;
    const rewardPerImpression = 1n * 10n**6n;
    const contentCid = keccak256(toBytes("test-cid"));
    const contentURI = "ipfs://QmTest";

    // Rejects end <= start
    const startTime1 = BigInt(Math.floor(Date.now() / 1000) + 100);
    const endTime1 = startTime1 - 10n;
    await expect(
      marketerMarket.write.createCampaign([
        contentCid,
        contentURI,
        budget,
        rewardPerImpression,
        startTime1,
        endTime1,
        2,
      ])
    ).to.be.rejectedWith("time");

    // Rejects end in past
    const startTime2 = BigInt(Math.floor(Date.now() / 1000) - 200);
    const endTime2 = BigInt(Math.floor(Date.now() / 1000) - 100);
    await expect(
      marketerMarket.write.createCampaign([
        contentCid,
        contentURI,
        budget,
        rewardPerImpression,
        startTime2,
        endTime2,
        2,
      ])
    ).to.be.rejectedWith("time");
  });

  it("4. topUpCampaign only by marketer, only when active", async () => {
    const { owner, marketer, market, marketerMarket } = await deployFixture();
    
    const budget = 100n * 10n**6n;
    const rewardPerImpression = 1n * 10n**6n;
    const startTime = BigInt(Math.floor(Date.now() / 1000) + 10);
    const endTime = startTime + 3600n;
    const contentCid = keccak256(toBytes("test-cid"));

    await marketerMarket.write.createCampaign([
      contentCid,
      "ipfs://QmTest",
      budget,
      rewardPerImpression,
      startTime,
      endTime,
      2,
    ]);

    // Top up by marketer
    const topupAmount = 50n * 10n**6n;
    await marketerMarket.write.topUpCampaign([1n, topupAmount]);

    const campaign = await market.read.campaigns([1n]);
    expect(campaign[3]).to.equal(budget + topupAmount);

    // Rejects top up by non-marketer (e.g. owner)
    const ownerMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: owner } });
    await expect(
      ownerMarket.write.topUpCampaign([1n, topupAmount])
    ).to.be.rejectedWith("owner");

    // Close campaign
    await marketerMarket.write.closeCampaign([1n]);

    // Rejects top up when closed
    await expect(
      marketerMarket.write.topUpCampaign([1n, topupAmount])
    ).to.be.rejectedWith("closed");
  });

  it("5. closeCampaign only by marketer; refunds remaining budget", async () => {
    const { owner, marketer, market, usdc, marketerMarket } = await deployFixture();
    
    const budget = 100n * 10n**6n;
    const rewardPerImpression = 1n * 10n**6n;
    const startTime = BigInt(Math.floor(Date.now() / 1000) + 10);
    const endTime = startTime + 3600n;
    
    await marketerMarket.write.createCampaign([
      keccak256(toBytes("cid")),
      "ipfs://QmTest",
      budget,
      rewardPerImpression,
      startTime,
      endTime,
      2,
    ]);

    const balBefore = await usdc.read.balanceOf([marketer.account.address]);

    // Rejects close by non-owner of campaign
    const ownerMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: owner } });
    await expect(
      ownerMarket.write.closeCampaign([1n])
    ).to.be.rejectedWith("owner");

    // Close campaign
    await marketerMarket.write.closeCampaign([1n]);

    const campaign = await market.read.campaigns([1n]);
    expect(campaign[8]).to.be.false; // active should be false
    expect(campaign[3]).to.equal(0n); // budgetRemaining should be 0

    const balAfter = await usdc.read.balanceOf([marketer.account.address]);
    expect(balAfter - balBefore).to.equal(budget); // Refund received

    // Rejects close again
    await expect(
      marketerMarket.write.closeCampaign([1n])
    ).to.be.rejectedWith("closed");
  });

  it("6. batchAnchor only by serverSigner; reverts for non-server caller", async () => {
    const { owner, marketer, serverSigner, viewer, market, marketerMarket } = await deployFixture();

    const budget = 100n * 10n**6n;
    const rewardPerImpression = 1n * 10n**6n;
    const startTime = BigInt(Math.floor(Date.now() / 1000) + 10);
    const endTime = startTime + 3600n;
    
    await marketerMarket.write.createCampaign([
      keccak256(toBytes("cid")),
      "ipfs://QmTest",
      budget,
      rewardPerImpression,
      startTime,
      endTime,
      2,
    ]);

    const receiptId = keccak256(toBytes("receipt-1"));
    const merkleRoot = keccak256(toBytes("merkle-root"));

    // Call from non-server (marketer) -> Reverts
    await expect(
      marketerMarket.write.batchAnchor([
        merkleRoot,
        [receiptId],
        [1n],
        [viewer.account.address],
        [rewardPerImpression],
      ])
    ).to.be.rejectedWith("not server");

    // Call from server -> Succeeds
    const serverMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: serverSigner } });
    await serverMarket.write.batchAnchor([
      merkleRoot,
      [receiptId],
      [1n],
      [viewer.account.address],
      [rewardPerImpression],
    ]);

    const served = await market.read.impressionsServed([1n]);
    expect(served).to.equal(1n);
  });

  it("7. batchAnchor rejects duplicate receipts", async () => {
    const { serverSigner, viewer, market, marketerMarket } = await deployFixture();

    const budget = 100n * 10n**6n;
    const rewardPerImpression = 1n * 10n**6n;
    const startTime = BigInt(Math.floor(Date.now() / 1000) + 10);
    const endTime = startTime + 3600n;
    
    await marketerMarket.write.createCampaign([
      keccak256(toBytes("cid")),
      "ipfs://QmTest",
      budget,
      rewardPerImpression,
      startTime,
      endTime,
      2,
    ]);

    const receiptId = keccak256(toBytes("receipt-2"));
    const merkleRoot = keccak256(toBytes("merkle-root"));
    const serverMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: serverSigner } });

    // Success first time
    await serverMarket.write.batchAnchor([
      merkleRoot,
      [receiptId],
      [1n],
      [viewer.account.address],
      [rewardPerImpression],
    ]);

    // Reverts on duplicate
    await expect(
      serverMarket.write.batchAnchor([
        merkleRoot,
        [receiptId],
        [1n],
        [viewer.account.address],
        [rewardPerImpression],
      ])
    ).to.be.rejectedWith("dup receipt");
  });

  it("8. batchAnchor rejects when array lengths mismatch", async () => {
    const { serverSigner, viewer, market, marketerMarket } = await deployFixture();

    const budget = 100n * 10n**6n;
    const rewardPerImpression = 1n * 10n**6n;
    const startTime = BigInt(Math.floor(Date.now() / 1000) + 10);
    const endTime = startTime + 3600n;
    
    await marketerMarket.write.createCampaign([
      keccak256(toBytes("cid")),
      "ipfs://QmTest",
      budget,
      rewardPerImpression,
      startTime,
      endTime,
      2,
    ]);

    const receiptId = keccak256(toBytes("receipt-3"));
    const merkleRoot = keccak256(toBytes("merkle-root"));
    const serverMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: serverSigner } });

    await expect(
      serverMarket.write.batchAnchor([
        merkleRoot,
        [receiptId],
        [1n],
        [viewer.account.address],
        [], // Empty amounts array
      ])
    ).to.be.rejectedWith("len");
  });

  it("9. batchAnchor rejects when campaign budget insufficient", async () => {
    const { serverSigner, viewer, market, marketerMarket } = await deployFixture();

    const budget = 10n * 10n**6n;
    const rewardPerImpression = 10n * 10n**6n;
    const startTime = BigInt(Math.floor(Date.now() / 1000) + 10);
    const endTime = startTime + 3600n;
    
    await marketerMarket.write.createCampaign([
      keccak256(toBytes("cid")),
      "ipfs://QmTest",
      budget,
      rewardPerImpression,
      startTime,
      endTime,
      2,
    ]);

    const receiptId = keccak256(toBytes("receipt-4"));
    const merkleRoot = keccak256(toBytes("merkle-root"));
    const serverMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: serverSigner } });

    // Try to anchor an amount larger than remaining budget (which is 10 USDC)
    await expect(
      serverMarket.write.batchAnchor([
        merkleRoot,
        [receiptId],
        [1n],
        [viewer.account.address],
        [11n * 10n**6n],
      ])
    ).to.be.rejectedWith("budget");
  });

  it("10. batchAnchor correctly splits platform fee", async () => {
    const { serverSigner, viewer, treasury, market, marketerMarket } = await deployFixture();

    const budget = 100n * 10n**6n;
    const rewardPerImpression = 10n * 10n**6n; // 10 USDC
    const startTime = BigInt(Math.floor(Date.now() / 1000) + 10);
    const endTime = startTime + 3600n;
    
    await marketerMarket.write.createCampaign([
      keccak256(toBytes("cid")),
      "ipfs://QmTest",
      budget,
      rewardPerImpression,
      startTime,
      endTime,
      2,
    ]);

    const receiptId = keccak256(toBytes("receipt-5"));
    const merkleRoot = keccak256(toBytes("merkle-root"));
    const serverMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: serverSigner } });

    await serverMarket.write.batchAnchor([
      merkleRoot,
      [receiptId],
      [1n],
      [viewer.account.address],
      [rewardPerImpression],
    ]);

    // Platform fee BPS is 1000 (10%)
    // Viewer should get 90% of 10 USDC = 9 USDC
    // Treasury should get 10% of 10 USDC = 1 USDC
    const pendingViewer = await market.read.pendingWithdraw([viewer.account.address]);
    const pendingTreasury = await market.read.pendingWithdraw([treasury.account.address]);

    expect(pendingViewer).to.equal(9n * 10n**6n);
    expect(pendingTreasury).to.equal(1n * 10n**6n);
  });

  it("11. userWithdraw zeroes pending then transfers; rejects when nothing pending", async () => {
    const { serverSigner, viewer, market, usdc, marketerMarket } = await deployFixture();

    const budget = 100n * 10n**6n;
    const rewardPerImpression = 10n * 10n**6n;
    const startTime = BigInt(Math.floor(Date.now() / 1000) + 10);
    const endTime = startTime + 3600n;
    
    await marketerMarket.write.createCampaign([
      keccak256(toBytes("cid")),
      "ipfs://QmTest",
      budget,
      rewardPerImpression,
      startTime,
      endTime,
      2,
    ]);

    const receiptId = keccak256(toBytes("receipt-6"));
    const serverMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: serverSigner } });

    await serverMarket.write.batchAnchor([
      keccak256(toBytes("merkle-root")),
      [receiptId],
      [1n],
      [viewer.account.address],
      [rewardPerImpression],
    ]);

    // Viewer withdraws
    const viewerMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: viewer } });
    
    const balBefore = await usdc.read.balanceOf([viewer.account.address]);
    await viewerMarket.write.userWithdraw();
    const balAfter = await usdc.read.balanceOf([viewer.account.address]);

    expect(balAfter - balBefore).to.equal(9n * 10n**6n); // 9 USDCnet

    const pendingAfter = await market.read.pendingWithdraw([viewer.account.address]);
    expect(pendingAfter).to.equal(0n);

    // Reject second withdraw
    await expect(
      viewerMarket.write.userWithdraw()
    ).to.be.rejectedWith("nothing");
  });

  it("12. setPlatformFeeBps capped at 2000 (20%)", async () => {
    const { owner, market } = await deployFixture();
    
    // Set fee to 15% (1500 Bps)
    await market.write.setPlatformFeeBps([1500]);
    const fee1 = await market.read.platformFeeBps();
    expect(fee1).to.equal(1500);

    // Reverts if > 2000
    await expect(
      market.write.setPlatformFeeBps([2001])
    ).to.be.rejectedWith("max 20%");
  });

  it("13. setServerSigner zero address rejected, and onlyOwner check", async () => {
    const { market, viewer } = await deployFixture();
    
    await expect(
      market.write.setServerSigner(["0x0000000000000000000000000000000000000000"])
    ).to.be.rejectedWith("zero");

    const viewerMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: viewer } });
    await expect(
      viewerMarket.write.setServerSigner([viewer.account.address])
    ).to.be.rejected;
  });

  it("15. setTreasury updates, rejects zero address, onlyOwner checks", async () => {
    const { market, viewer } = await deployFixture();
    
    await market.write.setTreasury([viewer.account.address]);
    const t = await market.read.treasury();
    expect(t.toLowerCase()).to.equal(viewer.account.address.toLowerCase());

    await expect(
      market.write.setTreasury(["0x0000000000000000000000000000000000000000"])
    ).to.be.rejectedWith("zero");

    const viewerMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: viewer } });
    await expect(
      viewerMarket.write.setTreasury([viewer.account.address])
    ).to.be.rejected;
  });

  it("16. setPlatformFeeBps onlyOwner checks", async () => {
    const { market, viewer } = await deployFixture();

    const viewerMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: viewer } });
    await expect(
      viewerMarket.write.setPlatformFeeBps([100])
    ).to.be.rejected;
  });

  it("14. Reentrancy guard on withdraw (using a malicious ERC20 mock)", async () => {
    const { serverSigner, viewer, market, usdc, marketerMarket } = await deployFixture();

    const budget = 100n * 10n**6n;
    const rewardPerImpression = 10n * 10n**6n;
    const startTime = BigInt(Math.floor(Date.now() / 1000) + 10);
    const endTime = startTime + 3600n;
    
    await marketerMarket.write.createCampaign([
      keccak256(toBytes("cid")),
      "ipfs://QmTest",
      budget,
      rewardPerImpression,
      startTime,
      endTime,
      2,
    ]);

    const receiptId = keccak256(toBytes("receipt-7"));
    const serverMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: serverSigner } });

    await serverMarket.write.batchAnchor([
      keccak256(toBytes("merkle")),
      [receiptId],
      [1n],
      [viewer.account.address],
      [rewardPerImpression],
    ]);

    // Setup malicious reentrancy hook on MockUSDC
    await usdc.write.setReenter([true, market.address]);

    const viewerMarket = await viem.getContractAt("MolfiAdMarket", market.address, { client: { wallet: viewer } });
    
    // withdraw should revert due to reentrancy lock (ReentrancyGuard)
    await expect(
      viewerMarket.write.userWithdraw()
    ).to.be.rejectedWith("reentry call failed");
  });
});
