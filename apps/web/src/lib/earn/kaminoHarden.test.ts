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
  KAMINO_API_TOKEN_MINTS,
  KAMINO_DEPOSIT_DISCRIMINATOR,
  KAMINO_KVAULT_PROGRAM_ID,
  KAMINO_VAULTS,
  KAMINO_WITHDRAW_DISCRIMINATOR,
  KaminoLiveError,
  SOL_SAFETY_BUFFER_LAMPORTS,
  TASK_CIRCLE_USDC_MINT_REFERENCE,
  TOKEN_PROGRAM_ID,
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

const PROBE = "J9EH8VmiXd58kuhhUCbED6Pm1dZU9fFQELhVE9UyMEKz";
const SOL_VAULT = "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg";
const STEAK_VAULT = "HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E";
const SOL_TOKEN_VAULT = "3Q9MzRtQaPtmydXUMVYqz6WTGSLFCGbs929mXTXTziw4";
const SOL_VAULT_FARM = "HdoYSQ8pzKMKHARtY6Uu682rcMxqkV2151vKsB1d7PeW";

const DEPOSIT_TX = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAHDP6yVnpnrNFfE1EzXBUnXC3c/t+j1VliPjsgxCv5iyghX7xkOP5ENZKDmGI/418jP35gW5O9K9RlQ4LbOQ9zL8lg7LsUR9rryAneOreZtIXorT+0KieLG4e86fq9w5jIw26YitWRV9lJ00NOXMIXl29/G/c2l1Hgt0GiI7swiZB7nUIEf1eQhs3BDr0pJXhranYWBuSjlRK57jISYW61zeEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/abOn2YZjdhw2KmG8wZ1xG+D4vUoNIeVL11QVj4+96jJclj04kifG7PRApFI4NgwtaE5na/xCEBI572Nvp+FnYsBAXY9PlHxJuYVbehd6MYTBZuERo0No/6KKiJRzHAQTZCvHbiTnsNf+U2WQNV9zDJ5S7Phu2b9OuhJqE3NuUBqfVFxksXFEhjMlMPUrxf1ja7gibof1E49vZigAAAAAG3fbh12Whk9nL4UbO63msHLSF7V9bN5E6jPWFfv8AqSZUhDCabmbSTWh9zSDQqtk1Luu69ETtjeArG2PnD3zkBwcGAAMAGgULAQEFAgADDAIAAACAlpgAAAAAAAsBAwERBwYABAAOBQsBAQkVABEMGhQOAwQZCwsGCRINDxAXFhgVEPIjxolS4fK2gJaYAAAAAAAICAAAAAABEwUKCG8Rufo8eib+CAgAARMCBA4ICxDOsMoSyNGzbP//////////ARo7tNPmLSDx6HSO+/un1b/nz2+fplPjHpqCsRpkX9ANCAQKBQwOAAgqBwIkFxAeBwM=";
const WITHDRAW_TX = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAGCf6yVnpnrNFfE1EzXBUnXC3c/t+j1VliPjsgxCv5iyghbpiK1ZFX2UnTQ05cwheXb38b9zaXUeC3QaIjuzCJkHudQgR/V5CGzcEOvSkleGtqdhYG5KOVErnuMhJhbrXN4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD9ps6fZhmN2HDYqYbzBnXEb4Pi9Sg0h5UvXVBWPj73qMlyWPTiSJ8bs9ECkUjg2DC1oTmdr/EIQEjnvY2+n4WZlxKXooAEJJPkJxkMd7ZH6G99GZch/RVimWXJ1rZZT4BNkK8duJOew1/5TZZA1X3MMnlLs+G7Zv066EmoTc25QG3fbh12Whk9nL4UbO63msHLSF7V9bN5E6jPWFfv8AqRTH+FrPZTSg7YZ1ca11JmjiiTdXpQDp5/o+KucudBt8AwUGAAEAEAMIAQEHFgAOBgkRARACCwgIFgQHDwoMDRQTFRIQE4Nwm6rcIjn//////////wgDAQAAAQkBGju00+YtIPHodI77+6fVv+fPb5+mU+MemoKxGmRf0A0IBAoFDA4ACAMGAiQXEB4H";

const DEPOSIT_LOOKUPS: KaminoLookupAddresses = {
  writable: [
    "3Q9MzRtQaPtmydXUMVYqz6WTGSLFCGbs929mXTXTziw4",
    "4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM",
    "5EBsGgVTubrd7ShJgE89k6nC2bnLzqGCjXb2ejrhtdBK",
    "6gTJfuPHEg6uRAijRkMqNc9kan4sVZejKMxmvx2grT1p",
    "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q",
    "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
    "DQ126djx5db6SMCbejHLNxoosonVes3qW5eVVUQuT93v",
    "HdoYSQ8pzKMKHARtY6Uu682rcMxqkV2151vKsB1d7PeW",
  ],
  readOnly: [
    "6TfTKE8f6y4HkgC5ReXMTxvmBMXzZwtkEuEDfbHz8WBJ",
    "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
    "C7h9YnjPrDvNhe2cWWDhCu4CZEB1XTTH4RzjmsHuengV",
    "GVDUXFwS8uvBG35RjZv6Y8S1AkV5uASiMJ9qTUKqb5PL",
    "H6rHXmXoCQvq8Ue81MqNh7ow5ysPa1dSozwW3PU1dDH6",
    "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
    "So11111111111111111111111111111111111111112",
  ],
};

const WITHDRAW_LOOKUPS: KaminoLookupAddresses = {
  writable: [
    "3Q9MzRtQaPtmydXUMVYqz6WTGSLFCGbs929mXTXTziw4",
    "4oigbthMAgjTMPyw8dBxhxU59YMtvNDHqhpR3W4HAzBM",
    "5EBsGgVTubrd7ShJgE89k6nC2bnLzqGCjXb2ejrhtdBK",
    "6gTJfuPHEg6uRAijRkMqNc9kan4sVZejKMxmvx2grT1p",
    "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q",
    "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
    "DQ126djx5db6SMCbejHLNxoosonVes3qW5eVVUQuT93v",
    "So11111111111111111111111111111111111111112",
  ],
  readOnly: [
    "6TfTKE8f6y4HkgC5ReXMTxvmBMXzZwtkEuEDfbHz8WBJ",
    "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF",
    "C7h9YnjPrDvNhe2cWWDhCu4CZEB1XTTH4RzjmsHuengV",
    "GVDUXFwS8uvBG35RjZv6Y8S1AkV5uASiMJ9qTUKqb5PL",
    "H6rHXmXoCQvq8Ue81MqNh7ow5ysPa1dSozwW3PU1dDH6",
    "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
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
        limitsWith({ tokenMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" }),
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

test("Steakhouse mint is labelled as the vault's asset mint, not native/Circle USDC", () => {
  // Curated metadata must equal the live Kamino API tokenMint (captured read-only).
  assert.equal(STEAK_META.assetMint, KAMINO_API_TOKEN_MINTS.steakhouseUsdc);
  // The 077 brief cites this as the Circle reference; the vault mint differs from it.
  assert.notEqual(STEAK_META.assetMint, TASK_CIRCLE_USDC_MINT_REFERENCE);
  const label = kaminoAssetMintLabel(STEAK_META);
  assert.equal(label, "Steakhouse vault USDC mint");
  assert.doesNotMatch(label, /native|Circle/i);
  assert.equal(kaminoAssetMintLabel(SOL_META), "SOL Balanced vault SOL mint");
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
      state: { ...SOL_LIMITS_RAW.state, tokenMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
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
