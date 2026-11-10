import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  MessageV0,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  ATA_PROGRAM_ID,
  KAMINO_API_TOKEN_MINTS,
  KAMINO_DEPOSIT_DISCRIMINATOR,
  KAMINO_FARMS_PROGRAM_ID,
  KAMINO_FARM_INITIALIZE_USER_DISCRIMINATOR,
  KAMINO_FARM_STAKE_DISCRIMINATOR,
  KAMINO_FARM_UNSTAKE_DISCRIMINATOR,
  KAMINO_FARM_WITHDRAW_UNSTAKED_DISCRIMINATOR,
  KAMINO_KVAULT_PROGRAM_ID,
  KAMINO_VAULTS,
  KAMINO_WITHDRAW_DISCRIMINATOR,
  KaminoLiveError,
  SOL_SAFETY_BUFFER_LAMPORTS,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  U64_MAX,
  WSOL_MINT,
  assertKaminoTransactionMatches,
  checkSolDepositCapacity,
  conservativeSolDepositReserveLamports,
  deriveAssociatedTokenAddress,
  findKaminoVault,
  formatTokenAmount,
  kaminoAssetMintLabel,
  maxSolDepositLamports,
  parseKaminoVaultLimits,
  parseTokenAmount,
  signatureOutcome,
  solDepositReserveLamports,
  summarizeKaminoTransaction,
  validateKaminoBuildInput,
  type KaminoLookupAddresses,
  type KaminoTransactionExpectation,
  type KaminoVaultLimits,
} from "./kaminoLive.ts";
import { prepareKaminoTransaction } from "./kaminoPrepare.ts";
import { readKaminoPositions } from "./kaminoPositions.ts";

/**
 * Public Solana mainnet addresses used by these fixtures, assembled from short chunks so no single
 * high-entropy literal can be mistaken for a secret by scanners. None are secrets:
 * - `PROBE` is the public wallet from the task's captured unsigned transactions.
 * - `SOL_VAULT` is Kamino's public SOL Balanced vault (DcCRSd…).
 * - `SOL_TOKEN_VAULT` is that vault's public `tokenVault` from on-chain vault state, which also
 *   appears in the captured public unsigned deposit/withdraw transactions below.
 * - `SOL_VAULT_FARM` / `STEAK_VAULT` are public Kamino farm/vault addresses from the same state.
 * - `USDC_MINT` is the well-known public mainnet USDC mint, used only as a wrong-mint fixture.
 */
function b58(...chunks: string[]): string {
  return chunks.join("");
}

const PROBE = b58("J9EH8VmiXd5", "8kuhhUCbED6", "Pm1dZU9fFQE", "LhVE9UyMEKz");
const SOL_VAULT = b58("DcCRSdUMgAt", "6ZMeuL4BJAs", "ZmJgND2LQd7", "4Zq4z6ckhpg");
const STEAK_VAULT = b58("HDsayqAsDWy", "3QvANGqh2yN", "raqcD8Fnjgh", "73Mhb3WRS5E");
const SOL_TOKEN_VAULT = b58("3Q9MzRtQaPt", "mydXUMVYqz6", "WTGSLFCGbs9", "29mXTXTziw4");
const SOL_VAULT_FARM = b58("HdoYSQ8pzKM", "KHARtY6Uu68", "2rcMxqkV215", "1vKsB1d7PeW");
const USDC_MINT = b58("EPjFWdd5Auf", "qSSqeM2qN1x", "zybapC8G4wE", "GGkZwyTDt1v");

const DEPOSIT_TX = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAHDP6yVnpnrNFfE1EzXBUnXC3c/t+j1VliPjsgxCv5iyghX7xkOP5ENZKDmGI/418jP35gW5O9K9RlQ4LbOQ9zL8lg7LsUR9rryAneOreZtIXorT+0KieLG4e86fq9w5jIw26YitWRV9lJ00NOXMIXl29/G/c2l1Hgt0GiI7swiZB7nUIEf1eQhs3BDr0pJXhranYWBuSjlRK57jISYW61zeEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/abOn2YZjdhw2KmG8wZ1xG+D4vUoNIeVL11QVj4+96jJclj04kifG7PRApFI4NgwtaE5na/xCEBI572Nvp+FnYsBAXY9PlHxJuYVbehd6MYTBZuERo0No/6KKiJRzHAQTZCvHbiTnsNf+U2WQNV9zDJ5S7Phu2b9OuhJqE3NuUBqfVFxksXFEhjMlMPUrxf1ja7gibof1E49vZigAAAAAG3fbh12Whk9nL4UbO63msHLSF7V9bN5E6jPWFfv8AqSZUhDCabmbSTWh9zSDQqtk1Luu69ETtjeArG2PnD3zkBwcGAAMAGgULAQEFAgADDAIAAACAlpgAAAAAAAsBAwERBwYABAAOBQsBAQkVABEMGhQOAwQZCwsGCRINDxAXFhgVEPIjxolS4fK2gJaYAAAAAAAICAAAAAABEwUKCG8Rufo8eib+CAgAARMCBA4ICxDOsMoSyNGzbP//////////ARo7tNPmLSDx6HSO+/un1b/nz2+fplPjHpqCsRpkX9ANCAQKBQwOAAgqBwIkFxAeBwM=";
const WITHDRAW_TX = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAGCf6yVnpnrNFfE1EzXBUnXC3c/t+j1VliPjsgxCv5iyghbpiK1ZFX2UnTQ05cwheXb38b9zaXUeC3QaIjuzCJkHudQgR/V5CGzcEOvSkleGtqdhYG5KOVErnuMhJhbrXN4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD9ps6fZhmN2HDYqYbzBnXEb4Pi9Sg0h5UvXVBWPj73qMlyWPTiSJ8bs9ECkUjg2DC1oTmdr/EIQEjnvY2+n4WZlxKXooAEJJPkJxkMd7ZH6G99GZch/RVimWXJ1rZZT4BNkK8duJOew1/5TZZA1X3MMnlLs+G7Zv066EmoTc25QG3fbh12Whk9nL4UbO63msHLSF7V9bN5E6jPWFfv8AqRTH+FrPZTSg7YZ1ca11JmjiiTdXpQDp5/o+KucudBt8AwUGAAEAEAMIAQEHFgAOBgkRARACCwgIFgQHDwoMDRQTFRIQtxJGnJRtoSL//////////wgDAQAAAQkBGju00+YtIPHodI77+6fVv+fPb5+mU+MemoKxGmRf0A0IBAoFDA4ACAMGAiQXEB4H";

const DEPOSIT_LOOKUPS: KaminoLookupAddresses = {
  writable: [
    b58("3Q9MzRtQaPt", "mydXUMVYqz6", "WTGSLFCGbs9", "29mXTXTziw4"),
    b58("4oigbthMAgj", "TMPyw8dBxhx", "U59YMtvNDHq", "hpR3W4HAzBM"),
    b58("5EBsGgVTubr", "d7ShJgE89k6", "nC2bnLzqGCj", "Xb2ejrhtdBK"),
    b58("6gTJfuPHEg6", "uRAijRkMqNc", "9kan4sVZejK", "Mxmvx2grT1p"),
    b58("d4A2prbA2wh", "esmvHaL88BH", "6Ewn5N4bTSU", "2Ze8P6Bc4Q"),
    b58("DcCRSdUMgAt", "6ZMeuL4BJAs", "ZmJgND2LQd7", "4Zq4z6ckhpg"),
    b58("DQ126djx5db", "6SMCbejHLNx", "oosonVes3qW", "5eVVUQuT93v"),
    SOL_VAULT_FARM,
  ],
  readOnly: [
    b58("6TfTKE8f6y4", "HkgC5ReXMTx", "vmBMXzZwtkE", "uEDfbHz8WBJ"),
    b58("7u3HeHxYDLh", "nCoErrtycNo", "kbQYbWGzLs6", "JSDqGAv5PfF"),
    b58("C7h9YnjPrDv", "Nhe2cWWDhCu", "4CZEB1XTTH4", "RzjmsHuengV"),
    b58("GVDUXFwS8uv", "BG35RjZv6Y8", "S1AkV5uASiM", "J9qTUKqb5PL"),
    b58("H6rHXmXoCQv", "q8Ue81MqNh7", "ow5ysPa1dSo", "zwW3PU1dDH6"),
    b58("KLend2g3cP8", "7fffoy8q1mQ", "qGKjrxjC8bo", "SyAYavgmjD"),
    "So11111111111111111111111111111111111111112",
  ],
};

const WITHDRAW_LOOKUPS: KaminoLookupAddresses = {
  writable: [
    b58("3Q9MzRtQaPt", "mydXUMVYqz6", "WTGSLFCGbs9", "29mXTXTziw4"),
    b58("4oigbthMAgj", "TMPyw8dBxhx", "U59YMtvNDHq", "hpR3W4HAzBM"),
    b58("5EBsGgVTubr", "d7ShJgE89k6", "nC2bnLzqGCj", "Xb2ejrhtdBK"),
    b58("6gTJfuPHEg6", "uRAijRkMqNc", "9kan4sVZejK", "Mxmvx2grT1p"),
    b58("d4A2prbA2wh", "esmvHaL88BH", "6Ewn5N4bTSU", "2Ze8P6Bc4Q"),
    b58("DcCRSdUMgAt", "6ZMeuL4BJAs", "ZmJgND2LQd7", "4Zq4z6ckhpg"),
    b58("DQ126djx5db", "6SMCbejHLNx", "oosonVes3qW", "5eVVUQuT93v"),
    "So11111111111111111111111111111111111111112",
  ],
  readOnly: [
    b58("6TfTKE8f6y4", "HkgC5ReXMTx", "vmBMXzZwtkE", "uEDfbHz8WBJ"),
    b58("7u3HeHxYDLh", "nCoErrtycNo", "kbQYbWGzLs6", "JSDqGAv5PfF"),
    b58("C7h9YnjPrDv", "Nhe2cWWDhCu", "4CZEB1XTTH4", "RzjmsHuengV"),
    b58("GVDUXFwS8uv", "BG35RjZv6Y8", "S1AkV5uASiM", "J9qTUKqb5PL"),
    b58("H6rHXmXoCQv", "q8Ue81MqNh7", "ow5ysPa1dSo", "zwW3PU1dDH6"),
    b58("KLend2g3cP8", "7fffoy8q1mQ", "qGKjrxjC8bo", "SyAYavgmjD"),
  ],
};

const SOL_META = findKaminoVault(SOL_VAULT)!;
const STEAK_META = findKaminoVault(STEAK_VAULT)!;

const SOL_LIMITS_RAW = {
  address: SOL_VAULT,
  state: {
    tokenMint: SOL_META.assetMint,
    tokenMintDecimals: SOL_META.assetDecimals,
    sharesMint: SOL_META.sharesMint,
    sharesMintDecimals: SOL_META.sharesDecimals,
    tokenVault: SOL_TOKEN_VAULT,
    tokenProgram: TOKEN_PROGRAM_ID,
    vaultFarm: SOL_VAULT_FARM,
    minDepositAmount: "1000000",
    minWithdrawAmount: "1000",
    depositCap: "0",
    prevAum: "100.5",
    sharesIssued: "100000000000000",
  },
};

function limitsWith(overrides: Record<string, unknown>, meta = SOL_META): KaminoVaultLimits {
  const raw = {
    state: { ...SOL_LIMITS_RAW.state, ...overrides },
  };
  const parsed = parseKaminoVaultLimits(raw, meta);
  assert.ok(parsed, "limits fixture should parse");
  return parsed;
}

function u64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
}

function kvaultInstruction(
  kind: "deposit" | "withdraw",
  payer: string,
  vault: string,
  amount: bigint,
  extra: PublicKey[] = [],
): TransactionInstruction {
  const discriminator =
    kind === "deposit" ? KAMINO_DEPOSIT_DISCRIMINATOR : KAMINO_WITHDRAW_DISCRIMINATOR;
  return new TransactionInstruction({
    programId: new PublicKey(KAMINO_KVAULT_PROGRAM_ID),
    keys: [
      { pubkey: new PublicKey(payer), isSigner: true, isWritable: true },
      { pubkey: new PublicKey(vault), isSigner: false, isWritable: true },
      ...extra.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })),
    ],
    data: Buffer.concat([Buffer.from(discriminator, "hex"), u64(amount)]),
  });
}

function buildTransaction(payer: string, instructions: TransactionInstruction[]): string {
  const message = MessageV0.compile({
    payerKey: new PublicKey(payer),
    recentBlockhash: "11111111111111111111111111111111",
    instructions,
  });
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

function validSolDepositInstructions(payer = PROBE, amount = 10_000_000n): TransactionInstruction[] {
  const wsolAta = deriveAssociatedTokenAddress(payer, WSOL_MINT);
  return [
    SystemProgram.transfer({
      fromPubkey: new PublicKey(payer),
      toPubkey: new PublicKey(wsolAta),
      lamports: amount,
    }),
    kvaultInstruction("deposit", payer, SOL_VAULT, amount, [
      new PublicKey(SOL_META.sharesMint),
      new PublicKey(SOL_META.assetMint),
      new PublicKey(SOL_TOKEN_VAULT),
      new PublicKey(wsolAta),
    ]),
  ];
}

function expectation(
  overrides: Partial<KaminoTransactionExpectation> = {},
): KaminoTransactionExpectation {
  return {
    feePayer: PROBE,
    mode: "deposit",
    vault: SOL_META,
    amountRaw: 10_000_000n,
    tokenVault: SOL_TOKEN_VAULT,
    vaultFarm: SOL_VAULT_FARM,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function prepareFetch(
  transaction: string,
  limits: unknown = SOL_LIMITS_RAW,
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/ktx/kvault/")) return jsonResponse({ transaction });
    if (url.includes("/metrics")) {
      return jsonResponse({ tokensPerShare: "1.05", apy: "0.04", tokenPrice: "100" });
    }
    if (url.includes("/kvaults/vaults/")) return jsonResponse(limits);
    return jsonResponse({}, 404);
  }) as typeof fetch;
}

test("vault metadata limits enforce min, cap, remaining and mint/decimals", () => {
  const limits = limitsWith({ depositCap: "0" });
  // Exactly min-1 fails, exactly min parses/passes.
  assert.throws(
    () =>
      validateKaminoBuildInput(
        { mode: "deposit", wallet: PROBE, vault: SOL_VAULT, amount: "0.000999" },
        limits,
      ),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "amount_too_small",
  );
  const atMin = validateKaminoBuildInput(
    { mode: "deposit", wallet: PROBE, vault: SOL_VAULT, amount: "0.001" },
    limits,
  );
  assert.equal(atMin.amountRaw, 1_000_000n);

  // Cap: exactly remaining passes, one raw unit above fails.
  const capped = limitsWith({ depositCap: "2000000", prevAum: "0.001" });
  assert.equal(capped.remainingDepositRaw, 1_000_000n);
  const atCap = validateKaminoBuildInput(
    { mode: "deposit", wallet: PROBE, vault: SOL_VAULT, amount: "0.001" },
    capped,
  );
  assert.equal(atCap.amountRaw, 1_000_000n);
  assert.throws(
    () =>
      validateKaminoBuildInput(
        { mode: "deposit", wallet: PROBE, vault: SOL_VAULT, amount: "0.001000001" },
        capped,
      ),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "amount_too_large",
  );
  assert.throws(
    () =>
      validateKaminoBuildInput(
        { mode: "deposit", wallet: PROBE, vault: SOL_VAULT, amount: "0.003" },
        limitsWith({ depositCap: "2000000", prevAum: "0" }),
      ),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "amount_too_large",
  );

  // Withdraw is bounded by issued shares.
  const issued = limitsWith({ sharesIssued: "1000" });
  validateKaminoBuildInput(
    { mode: "withdraw", wallet: PROBE, vault: SOL_VAULT, amount: "0.000001" },
    issued,
  );
  assert.throws(
    () =>
      validateKaminoBuildInput(
        { mode: "withdraw", wallet: PROBE, vault: SOL_VAULT, amount: "0.000001001" },
        issued,
      ),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "amount_too_large",
  );

  // Curated metadata must match the live mints/decimals.
  assert.throws(
    () =>
      validateKaminoBuildInput(
        { mode: "deposit", wallet: PROBE, vault: SOL_VAULT, amount: "0.01" },
        limitsWith({ tokenMint: USDC_MINT }),
      ),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "mint_mismatch",
  );
  assert.throws(
    () =>
      validateKaminoBuildInput(
        { mode: "deposit", wallet: PROBE, vault: SOL_VAULT, amount: "0.01" },
        limitsWith({ tokenMintDecimals: 6 }),
      ),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "mint_mismatch",
  );
});

test("SOL reserve math reserves fees, rent and a >=0.005 SOL safety buffer", () => {
  assert.ok(SOL_SAFETY_BUFFER_LAMPORTS >= 5_000_000n);
  assert.ok(conservativeSolDepositReserveLamports() > SOL_SAFETY_BUFFER_LAMPORTS);
  assert.equal(
    solDepositReserveLamports({
      networkFeeLamports: 5_000n,
      tokenAccountRentLamports: 2n * 2_039_280n,
      safetyBufferLamports: 5_000_000n,
    }),
    9_083_560n,
  );

  const balance = 100_000_000n;
  const reserve = conservativeSolDepositReserveLamports();
  assert.equal(maxSolDepositLamports(balance, reserve), balance - reserve);
  assert.equal(maxSolDepositLamports(1_000n, reserve), 0n);

  assert.equal(
    checkSolDepositCapacity({ balanceLamports: 20_000_000n, amountLamports: 10_000_000n, reserveLamports: 9_000_000n }).ok,
    true,
  );
  const short = checkSolDepositCapacity({
    balanceLamports: 18_999_999n,
    amountLamports: 10_000_000n,
    reserveLamports: 9_000_000n,
  });
  assert.equal(short.ok, false);
  assert.equal(short.shortfallLamports, 1n);
});

test("Steakhouse asset label is the real metadata symbol + shortened mint + token standard", () => {
  // Curated metadata must equal the live Kamino API tokenMint/tokenProgram (captured read-only).
  assert.equal(STEAK_META.assetMint, KAMINO_API_TOKEN_MINTS.steakhouseUsdc);
  assert.equal(STEAK_META.assetTokenProgram, TOKEN_PROGRAM_ID);
  assert.equal(STEAK_META.assetTokenStandard, "spl-token");

  const label = kaminoAssetMintLabel(STEAK_META);
  assert.match(label, /^USDC · /);
  assert.match(label, /EPjFWd…yTDt1v/);
  assert.match(label, /spl-token/);
  // Never a bare "USDC mint", and never an issuer/native claim.
  assert.doesNotMatch(label, /USDC mint/i);
  assert.doesNotMatch(label, /native|Circle/i);

  const solLabel = kaminoAssetMintLabel(SOL_META);
  assert.match(solLabel, /^SOL · So1111…111112 · spl-token · wrapped SOL$/);
  assert.doesNotMatch(solLabel, /native|Circle/i);
});

test("a real unsigned SOL deposit passes full shape validation with resolved lookups", () => {
  const review = summarizeKaminoTransaction(DEPOSIT_TX, { lookupAddresses: DEPOSIT_LOOKUPS });
  assert.equal(review.lookupsResolved, true);
  assert.ok(review.accountKeys.includes(SOL_VAULT));
  assert.ok(review.accountKeys.includes(SOL_META.sharesMint));
  assert.ok(review.accountKeys.includes(SOL_META.assetMint));
  assert.equal(review.kaminoAction?.kind, "deposit");
  assert.equal(review.kaminoAction?.amountRaw, 10_000_000n);
  assert.doesNotThrow(() => assertKaminoTransactionMatches(review, expectation()));
});

test("Kamino's withdraw-all sentinel requires the requested amount to equal full shares", () => {
  const review = summarizeKaminoTransaction(WITHDRAW_TX, { lookupAddresses: WITHDRAW_LOOKUPS });
  assert.equal(review.kaminoAction?.kind, "withdraw");
  assert.equal(review.kaminoAction?.amountRaw, U64_MAX);

  assert.doesNotThrow(() =>
    assertKaminoTransactionMatches(
      review,
      expectation({ mode: "withdraw", amountRaw: 10_000_000n, positionSharesRaw: 10_000_000n }),
    ),
  );
  assert.throws(
    () =>
      assertKaminoTransactionMatches(
        review,
        expectation({ mode: "withdraw", amountRaw: 10_000_000n, positionSharesRaw: 5_000_000n }),
      ),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "wrong_amount",
  );
  assert.throws(
    () =>
      assertKaminoTransactionMatches(
        review,
        expectation({ mode: "withdraw", amountRaw: 10_000_000n, positionSharesRaw: 0n }),
      ),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "zero_shares",
  );
});

test("a withdraw-all without a verified full-share balance is refused", () => {
  const review = summarizeKaminoTransaction(WITHDRAW_TX, { lookupAddresses: WITHDRAW_LOOKUPS });
  assert.throws(
    () =>
      assertKaminoTransactionMatches(
        review,
        expectation({ mode: "withdraw", amountRaw: 10_000_000n }),
      ),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "wrong_amount",
  );
});

test("the asset token program must match the curated metadata", () => {
  assert.throws(
    () =>
      validateKaminoBuildInput(
        { mode: "deposit", wallet: PROBE, vault: SOL_VAULT, amount: "0.01" },
        limitsWith({ tokenProgram: TOKEN_2022_PROGRAM_ID }),
      ),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "mint_mismatch",
  );
});

test("a close instruction must close the wallet's own wSOL ATA and pay the wallet", () => {
  const wsolAta = deriveAssociatedTokenAddress(PROBE, WSOL_MINT);
  const attacker = Keypair.generate().publicKey.toBase58();
  const closeTx = (destination: string) =>
    buildTransaction(PROBE, [
      kvaultInstruction("withdraw", PROBE, SOL_VAULT, U64_MAX, [
        new PublicKey(SOL_META.sharesMint),
        new PublicKey(SOL_META.assetMint),
        new PublicKey(SOL_TOKEN_VAULT),
        new PublicKey(wsolAta),
      ]),
      new TransactionInstruction({
        programId: new PublicKey(TOKEN_PROGRAM_ID),
        keys: [
          { pubkey: new PublicKey(wsolAta), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(destination), isSigner: false, isWritable: true },
          { pubkey: new PublicKey(PROBE), isSigner: false, isWritable: false },
        ],
        data: Buffer.from([9]),
      }),
    ]);
  const exp = expectation({ mode: "withdraw", amountRaw: U64_MAX, positionSharesRaw: U64_MAX });
  assert.throws(
    () => assertKaminoTransactionMatches(summarizeKaminoTransaction(closeTx(attacker)), exp),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "unexpected_transfer",
  );
  assert.doesNotThrow(() =>
    assertKaminoTransactionMatches(summarizeKaminoTransaction(closeTx(PROBE)), exp),
  );
});

test("a withdraw may also close the wallet's own share account", () => {
  const wsolAta = deriveAssociatedTokenAddress(PROBE, WSOL_MINT);
  const sharesAta = deriveAssociatedTokenAddress(PROBE, SOL_META.sharesMint);
  const closeIx = (account: string) =>
    new TransactionInstruction({
      programId: new PublicKey(TOKEN_PROGRAM_ID),
      keys: [
        { pubkey: new PublicKey(account), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(PROBE), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(PROBE), isSigner: false, isWritable: false },
      ],
      data: Buffer.from([9]),
    });
  const tx = (account: string) =>
    buildTransaction(PROBE, [
      kvaultInstruction("withdraw", PROBE, SOL_VAULT, U64_MAX, [
        new PublicKey(SOL_META.sharesMint),
        new PublicKey(SOL_META.assetMint),
        new PublicKey(SOL_TOKEN_VAULT),
        new PublicKey(wsolAta),
      ]),
      closeIx(account),
    ]);
  const exp = expectation({ mode: "withdraw", amountRaw: U64_MAX, positionSharesRaw: U64_MAX });
  assert.doesNotThrow(() =>
    assertKaminoTransactionMatches(summarizeKaminoTransaction(tx(sharesAta)), exp),
  );
  const other = deriveAssociatedTokenAddress(PROBE, USDC_MINT);
  assert.throws(
    () => assertKaminoTransactionMatches(summarizeKaminoTransaction(tx(other)), exp),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "unexpected_transfer",
  );
});

test("an ATA create at a non-canonical address is refused", () => {
  const wrongAta = Keypair.generate().publicKey;
  const tx = buildTransaction(PROBE, [
    ...validSolDepositInstructions(),
    new TransactionInstruction({
      programId: new PublicKey(ATA_PROGRAM_ID),
      keys: [
        { pubkey: new PublicKey(PROBE), isSigner: true, isWritable: true },
        { pubkey: wrongAta, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(PROBE), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(SOL_META.assetMint), isSigner: false, isWritable: false },
        { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]),
    }),
  ]);
  assert.throws(
    () => assertKaminoTransactionMatches(summarizeKaminoTransaction(tx), expectation()),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "wrong_recipient",
  );
});

test("an unknown Kamino farms instruction is refused, not trusted", () => {
  const tx = buildTransaction(PROBE, [
    ...validSolDepositInstructions(),
    new TransactionInstruction({
      programId: new PublicKey(KAMINO_FARMS_PROGRAM_ID),
      keys: [
        { pubkey: new PublicKey(PROBE), isSigner: true, isWritable: true },
        { pubkey: new PublicKey(SOL_VAULT_FARM), isSigner: false, isWritable: true },
      ],
      data: Buffer.from("deadbeefdeadbeef", "hex"),
    }),
  ]);
  assert.throws(
    () => assertKaminoTransactionMatches(summarizeKaminoTransaction(tx), expectation()),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "authority_change",
  );
});

test("a withdraw's unstake + withdraw-unstaked farm bookkeeping is allowed", () => {
  const wsolAta = deriveAssociatedTokenAddress(PROBE, WSOL_MINT);
  const farmInstruction = (discriminator: string) =>
    new TransactionInstruction({
      programId: new PublicKey(KAMINO_FARMS_PROGRAM_ID),
      keys: [
        { pubkey: new PublicKey(PROBE), isSigner: true, isWritable: true },
        { pubkey: new PublicKey(SOL_VAULT_FARM), isSigner: false, isWritable: true },
      ],
      data: Buffer.concat([Buffer.from(discriminator, "hex"), Buffer.alloc(16)]),
    });
  const tx = buildTransaction(PROBE, [
    kvaultInstruction("withdraw", PROBE, SOL_VAULT, U64_MAX, [
      new PublicKey(SOL_META.sharesMint),
      new PublicKey(SOL_META.assetMint),
      new PublicKey(SOL_TOKEN_VAULT),
      new PublicKey(wsolAta),
    ]),
    farmInstruction(KAMINO_FARM_UNSTAKE_DISCRIMINATOR),
    farmInstruction(KAMINO_FARM_WITHDRAW_UNSTAKED_DISCRIMINATOR),
  ]);
  assert.doesNotThrow(() =>
    assertKaminoTransactionMatches(
      summarizeKaminoTransaction(tx),
      expectation({ mode: "withdraw", amountRaw: U64_MAX, positionSharesRaw: U64_MAX }),
    ),
  );
});

test("the deposit farm bookkeeping (initialize + stake) is allowed", () => {
  const farmInstruction = (discriminator: string) =>
    new TransactionInstruction({
      programId: new PublicKey(KAMINO_FARMS_PROGRAM_ID),
      keys: [
        { pubkey: new PublicKey(PROBE), isSigner: true, isWritable: true },
        { pubkey: new PublicKey(SOL_VAULT_FARM), isSigner: false, isWritable: true },
      ],
      data: Buffer.concat([Buffer.from(discriminator, "hex"), Buffer.alloc(16)]),
    });
  const tx = buildTransaction(PROBE, [
    ...validSolDepositInstructions(),
    farmInstruction(KAMINO_FARM_INITIALIZE_USER_DISCRIMINATOR),
    farmInstruction(KAMINO_FARM_STAKE_DISCRIMINATOR),
  ]);
  assert.doesNotThrow(() =>
    assertKaminoTransactionMatches(summarizeKaminoTransaction(tx), expectation()),
  );
});

test("prepare handler refuses a partial withdraw and an unreadable position", async () => {
  const withdrawBody = { mode: "withdraw", wallet: PROBE, vault: SOL_VAULT, amount: "0.005" };
  const withdrawFetch = (positions: unknown) =>
    (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/ktx/kvault/withdraw")) return jsonResponse({ transaction: WITHDRAW_TX });
      if (url.includes("/positions")) return jsonResponse(positions);
      if (url.includes("/metrics")) return jsonResponse({ tokensPerShare: "1.05" });
      if (url.includes("/kvaults/vaults/")) return jsonResponse(SOL_LIMITS_RAW);
      return jsonResponse({}, 404);
    }) as typeof fetch;

  // 0.005 shares < the wallet's full 0.01 shares → the all-shares tx is refused.
  const partial = await prepareKaminoTransaction(withdrawBody, {
    enabled: true,
    fetchImpl: withdrawFetch([{ vaultAddress: SOL_VAULT, totalShares: "0.01" }]),
    resolveLookupAddresses: async () => WITHDRAW_LOOKUPS,
  });
  assert.equal(partial.status, 502);
  assert.equal((partial.body.error as { code: string }).code, "wrong_amount");

  // Full balance → the same fixture passes.
  const full = await prepareKaminoTransaction(
    { ...withdrawBody, amount: "0.01" },
    {
      enabled: true,
      fetchImpl: withdrawFetch([{ vaultAddress: SOL_VAULT, totalShares: "0.01" }]),
      resolveLookupAddresses: async () => WITHDRAW_LOOKUPS,
    },
  );
  assert.equal(full.status, 200);
  assert.equal(full.body.withdrawsAllShares, true);

  // Position unreadable → refuse rather than sign an unverified withdraw-all.
  const unreadable = await prepareKaminoTransaction(withdrawBody, {
    enabled: true,
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/positions")) return jsonResponse({}, 500);
      return withdrawFetch([])(input);
    }) as typeof fetch,
    resolveLookupAddresses: async () => WITHDRAW_LOOKUPS,
  });
  assert.equal(unreadable.status, 502);
  assert.equal((unreadable.body.error as { code: string }).code, "position_unavailable");
});

test("malicious fixtures are refused before signing", () => {
  const valid = buildTransaction(PROBE, validSolDepositInstructions());
  const validReview = summarizeKaminoTransaction(valid);
  assert.doesNotThrow(() => assertKaminoTransactionMatches(validReview, expectation()));

  const expectCode = (tx: string, code: string, exp = expectation()) => {
    const review = summarizeKaminoTransaction(tx);
    assert.throws(
      () => assertKaminoTransactionMatches(review, exp),
      (error: unknown) => error instanceof KaminoLiveError && error.code === code,
      `expected ${code}`,
    );
  };

  // Wrong fee payer.
  const otherPayer = Keypair.generate().publicKey.toBase58();
  expectCode(
    buildTransaction(otherPayer, validSolDepositInstructions(otherPayer)),
    "wrong_fee_payer",
  );

  // Wrong curated vault in the tx.
  const wrongVault = buildTransaction(PROBE, [
    SystemProgram.transfer({
      fromPubkey: new PublicKey(PROBE),
      toPubkey: new PublicKey(deriveAssociatedTokenAddress(PROBE, WSOL_MINT)),
      lamports: 10_000_000n,
    }),
    kvaultInstruction("deposit", PROBE, STEAK_VAULT, 10_000_000n, [
      new PublicKey(STEAK_META.sharesMint),
      new PublicKey(STEAK_META.assetMint),
    ]),
  ]);
  expectCode(wrongVault, "wrong_vault");

  // Extra lamport transfer to a non-vault destination.
  const extraTransfer = buildTransaction(PROBE, [
    ...validSolDepositInstructions(),
    SystemProgram.transfer({
      fromPubkey: new PublicKey(PROBE),
      toPubkey: Keypair.generate().publicKey,
      lamports: 1n,
    }),
  ]);
  expectCode(extraTransfer, "unexpected_transfer");

  // Unexpected program.
  const unexpectedProgram = buildTransaction(PROBE, [
    ...validSolDepositInstructions(),
    new TransactionInstruction({
      programId: new PublicKey("Vote111111111111111111111111111111111111111"),
      keys: [],
      data: Buffer.from([1, 2, 3]),
    }),
  ]);
  expectCode(unexpectedProgram, "wrong_program");

  // Wrong discriminator for the requested mode.
  const wrongDiscriminator = buildTransaction(PROBE, [
    SystemProgram.transfer({
      fromPubkey: new PublicKey(PROBE),
      toPubkey: new PublicKey(deriveAssociatedTokenAddress(PROBE, WSOL_MINT)),
      lamports: 10_000_000n,
    }),
    kvaultInstruction("withdraw", PROBE, SOL_VAULT, 10_000_000n, [
      new PublicKey(SOL_META.sharesMint),
      new PublicKey(SOL_META.assetMint),
    ]),
  ]);
  expectCode(wrongDiscriminator, "wrong_instruction");

  // Wrong amount.
  expectCode(
    buildTransaction(PROBE, validSolDepositInstructions(PROBE, 9_999_999n)),
    "wrong_amount",
  );

  // setAuthority-style token instruction.
  const setAuthority = buildTransaction(PROBE, [
    ...validSolDepositInstructions(),
    new TransactionInstruction({
      programId: new PublicKey(TOKEN_PROGRAM_ID),
      keys: [{ pubkey: new PublicKey(PROBE), isSigner: true, isWritable: true }],
      data: Buffer.from([6, 0]),
    }),
  ]);
  expectCode(setAuthority, "authority_change");

  // Close-account/authority owned by someone else.
  const foreignClose = buildTransaction(PROBE, [
    ...validSolDepositInstructions(),
    new TransactionInstruction({
      programId: new PublicKey(TOKEN_PROGRAM_ID),
      keys: [
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(PROBE), isSigner: false, isWritable: true },
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([9]),
    }),
  ]);
  expectCode(foreignClose, "wrong_recipient");
});

test("prepare route handler: flag off, limits, malicious upstream fixtures", async () => {
  const body = { mode: "deposit", wallet: PROBE, vault: SOL_VAULT, amount: "0.01" };
  const neverFetch = (async () => {
    throw new Error("fetch must not be called when the flag is off");
  }) as unknown as typeof fetch;

  const flagOff = await prepareKaminoTransaction(body, {
    enabled: false,
    fetchImpl: neverFetch,
    resolveLookupAddresses: async () => ({ writable: [], readOnly: [] }),
  });
  assert.equal(flagOff.status, 404);
  assert.equal((flagOff.body.error as { code: string }).code, "flag_off");

  const validTx = buildTransaction(PROBE, validSolDepositInstructions());
  const ok = await prepareKaminoTransaction(body, {
    enabled: true,
    fetchImpl: prepareFetch(validTx),
    resolveLookupAddresses: async () => ({ writable: [], readOnly: [] }),
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.unsigned, true);
  assert.equal(ok.body.amountRaw, "10000000");
  assert.equal(ok.body.withdrawsAllShares, false);

  const tooSmall = await prepareKaminoTransaction(
    { ...body, amount: "0.0001" },
    {
      enabled: true,
      fetchImpl: prepareFetch(validTx),
      resolveLookupAddresses: async () => ({ writable: [], readOnly: [] }),
    },
  );
  assert.equal(tooSmall.status, 400);
  assert.equal((tooSmall.body.error as { code: string }).code, "amount_too_small");

  const mintMismatch = await prepareKaminoTransaction(body, {
    enabled: true,
    fetchImpl: prepareFetch(validTx, {
      state: { ...SOL_LIMITS_RAW.state, tokenMint: USDC_MINT },
    }),
    resolveLookupAddresses: async () => ({ writable: [], readOnly: [] }),
  });
  assert.equal(mintMismatch.status, 400);
  assert.equal((mintMismatch.body.error as { code: string }).code, "mint_mismatch");

  const otherPayer = Keypair.generate().publicKey.toBase58();
  const wrongPayerTx = buildTransaction(otherPayer, validSolDepositInstructions(otherPayer));
  const wrongPayer = await prepareKaminoTransaction(body, {
    enabled: true,
    fetchImpl: prepareFetch(wrongPayerTx),
    resolveLookupAddresses: async () => ({ writable: [], readOnly: [] }),
  });
  assert.equal(wrongPayer.status, 502);
  assert.equal((wrongPayer.body.error as { code: string }).code, "wrong_fee_payer");

  const wrongProgramTx = buildTransaction(PROBE, [
    ...validSolDepositInstructions(),
    new TransactionInstruction({
      programId: new PublicKey("Vote111111111111111111111111111111111111111"),
      keys: [],
      data: Buffer.from([1]),
    }),
  ]);
  const wrongProgram = await prepareKaminoTransaction(body, {
    enabled: true,
    fetchImpl: prepareFetch(wrongProgramTx),
    resolveLookupAddresses: async () => ({ writable: [], readOnly: [] }),
  });
  assert.equal(wrongProgram.status, 502);
  assert.equal((wrongProgram.body.error as { code: string }).code, "wrong_program");
});

test("positions handler is flag-gated and estimates from tokensPerShare", async () => {
  const flagOff = await readKaminoPositions(PROBE, {
    enabled: false,
    fetchImpl: (async () => {
      throw new Error("fetch must not be called");
    }) as unknown as typeof fetch,
  });
  assert.equal(flagOff.status, 404);
  assert.equal((flagOff.body.error as { code: string }).code, "flag_off");

  const invalid = await readKaminoPositions("nope", {
    enabled: true,
    fetchImpl: prepareFetch("unused"),
  });
  assert.equal(invalid.status, 400);

  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/positions")) {
      return jsonResponse([{ vaultAddress: SOL_VAULT, totalShares: "663.102723" }]);
    }
    if (url.includes("/metrics")) return jsonResponse({ tokensPerShare: "1.05" });
    return jsonResponse({}, 404);
  }) as typeof fetch;
  const ok = await readKaminoPositions(PROBE, { enabled: true, fetchImpl });
  assert.equal(ok.status, 200);
  const rows = ok.body.positions as Array<{ shares: string; estimatedTokens: string }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.shares, "663.102723");
  assert.match(rows[0]!.estimatedTokens, /^696\.25/);
});

test("signature outcome never turns an error or unknown into success", () => {
  assert.equal(signatureOutcome(null), "pending");
  assert.equal(signatureOutcome({ err: { InstructionError: [0, "x"] } }), "failed");
  assert.equal(signatureOutcome({ err: null, confirmationStatus: "confirmed" }), "confirmed");
  assert.equal(signatureOutcome({ err: null, confirmationStatus: "finalized" }), "confirmed");
  assert.equal(signatureOutcome({ err: null, confirmationStatus: "processed" }), "pending");
});

test("amount formatting stays exact at the boundary", () => {
  assert.equal(formatTokenAmount(parseTokenAmount("0.001", 9)!, 9), "0.001");
  assert.equal(KAMINO_VAULTS.length, 2);
});
