import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  KAMINO_VAULTS,
  KaminoLiveError,
  TOKEN_2022_PROGRAM_ID,
  apyPercent,
  assertKaminoTransactionMatches,
  base64ToBytes,
  decodeKaminoTransaction,
  deriveAssociatedTokenAddress,
  deriveKaminoEstimate,
  findKaminoVault,
  formatLamports,
  formatTokenAmount,
  kaminoApiRequest,
  parseKaminoPositions,
  parseTokenAmount,
  summarizeKaminoTransaction,
  validateKaminoBuildInput,
  type KaminoLookupAddresses,
  type KaminoTransactionExpectation,
} from "./kaminoLive.ts";

// Public, unsigned transactions for the task's Solana probe wallet (0.01 SOL deposit and
// 0.01-share withdraw against the SOL Balanced vault). They contain no signature or secret.
const DEPOSIT_TX = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAHDP6yVnpnrNFfE1EzXBUnXC3c/t+j1VliPjsgxCv5iyghX7xkOP5ENZKDmGI/418jP35gW5O9K9RlQ4LbOQ9zL8lg7LsUR9rryAneOreZtIXorT+0KieLG4e86fq9w5jIw26YitWRV9lJ00NOXMIXl29/G/c2l1Hgt0GiI7swiZB7nUIEf1eQhs3BDr0pJXhranYWBuSjlRK57jISYW61zeEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/abOn2YZjdhw2KmG8wZ1xG+D4vUoNIeVL11QVj4+96jJclj04kifG7PRApFI4NgwtaE5na/xCEBI572Nvp+FnYsBAXY9PlHxJuYVbehd6MYTBZuERo0No/6KKiJRzHAQTZCvHbiTnsNf+U2WQNV9zDJ5S7Phu2b9OuhJqE3NuUBqfVFxksXFEhjMlMPUrxf1ja7gibof1E49vZigAAAAAG3fbh12Whk9nL4UbO63msHLSF7V9bN5E6jPWFfv8AqSZUhDCabmbSTWh9zSDQqtk1Luu69ETtjeArG2PnD3zkBwcGAAMAGgULAQEFAgADDAIAAACAlpgAAAAAAAsBAwERBwYABAAOBQsBAQkVABEMGhQOAwQZCwsGCRINDxAXFhgVEPIjxolS4fK2gJaYAAAAAAAICAAAAAABEwUKCG8Rufo8eib+CAgAARMCBA4ICxDOsMoSyNGzbP//////////ARo7tNPmLSDx6HSO+/un1b/nz2+fplPjHpqCsRpkX9ANCAQKBQwOAAgqBwIkFxAeBwM=";
const WITHDRAW_TX = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAGCf6yVnpnrNFfE1EzXBUnXC3c/t+j1VliPjsgxCv5iyghbpiK1ZFX2UnTQ05cwheXb38b9zaXUeC3QaIjuzCJkHudQgR/V5CGzcEOvSkleGtqdhYG5KOVErnuMhJhbrXN4QAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD9ps6fZhmN2HDYqYbzBnXEb4Pi9Sg0h5UvXVBWPj73qMlyWPTiSJ8bs9ECkUjg2DC1oTmdr/EIQEjnvY2+n4WZlxKXooAEJJPkJxkMd7ZH6G99GZch/RVimWXJ1rZZT4BNkK8duJOew1/5TZZA1X3MMnlLs+G7Zv066EmoTc25QG3fbh12Whk9nL4UbO63msHLSF7V9bN5E6jPWFfv8AqRTH+FrPZTSg7YZ1ca11JmjiiTdXpQDp5/o+KucudBt8AwUGAAEAEAMIAQEHFgAOBgkRARACCwgIFgQHDwoMDRQTFRIQtxJGnJRtoSL//////////wgDAQAAAQkBGju00+YtIPHodI77+6fVv+fPb5+mU+MemoKxGmRf0A0IBAoFDA4ACAMGAiQXEB4H";

/**
 * Public, unsigned transaction Kamino built for a partial withdraw (5,678,988 of 14,197,470 shares)
 * against the SOL Balanced vault. It uses the `withdraw_from_available` discriminator
 * (1383709baadc2239) instead of `withdraw`; the pre-sign guard must accept it as a normal withdraw.
 * The base64, lookup table and public addresses live in the JSON fixture (public data only).
 */
interface WithdrawFromAvailableFixture {
  readonly wallet: string;
  readonly vault: string;
  readonly vaultAccount: string;
  readonly vaultFarm: string;
  readonly sharesMint: string;
  readonly otherVault: string;
  readonly foreignOwner: string;
  readonly withdrawFromAvailable: {
    readonly encoding: "base64";
    readonly transaction: string;
    readonly signatures: number;
    readonly lookupAddresses: KaminoLookupAddresses;
  };
}

const FIXTURE = JSON.parse(
  readFileSync(
    new URL("./__fixtures__/kamino-withdraw-from-available-mainnet.json", import.meta.url),
    "utf8",
  ),
) as WithdrawFromAvailableFixture;

const WITHDRAW_FROM_AVAILABLE_TX = FIXTURE.withdrawFromAvailable.transaction;
const WITHDRAW_FROM_AVAILABLE_LOOKUPS = FIXTURE.withdrawFromAvailable.lookupAddresses;

const PROBE = FIXTURE.wallet;
const SOL_VAULT = FIXTURE.vault;
const SOL_TOKEN_VAULT = FIXTURE.vaultAccount;
const SOL_VAULT_FARM = FIXTURE.vaultFarm;
const OTHER_VAULT = FIXTURE.otherVault;
const FOREIGN_OWNER = FIXTURE.foreignOwner;

const SHARE_AMOUNT = 5_678_988n;
const POSITION_SHARES = 14_197_470n;

function withdrawFromAvailableReview() {
  return summarizeKaminoTransaction(WITHDRAW_FROM_AVAILABLE_TX, {
    lookupAddresses: WITHDRAW_FROM_AVAILABLE_LOOKUPS,
  });
}

function withdrawExpectation(
  overrides: Partial<KaminoTransactionExpectation> = {},
): KaminoTransactionExpectation {
  return {
    feePayer: PROBE,
    mode: "withdraw",
    vault: findKaminoVault(SOL_VAULT)!,
    amountRaw: SHARE_AMOUNT,
    tokenVault: SOL_TOKEN_VAULT,
    vaultFarm: SOL_VAULT_FARM,
    positionSharesRaw: POSITION_SHARES,
    ...overrides,
  };
}

/** Replace one positional account of the `withdraw_from_available` instruction only. */
function reviewWithWithdrawAccount(index: number, value: string) {
  const review = withdrawFromAvailableReview();
  const instructions = review.instructions.map((instruction) =>
    instruction.withdrawFromAvailable
      ? {
          ...instruction,
          accounts: instruction.accounts.map((account, i) => (i === index ? value : account)),
        }
      : instruction,
  );
  return { ...review, instructions };
}

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof KaminoLiveError && error.code === code;
}

test("token amounts parse exactly and reject overflow/zero", () => {
  assert.equal(parseTokenAmount("0.01", 9), 10_000_000n);
  assert.equal(parseTokenAmount("1,000.5", 6), 1_000_500_000n);
  assert.equal(parseTokenAmount("100", 6), 100_000_000n);
  assert.equal(parseTokenAmount("0", 6), null);
  assert.equal(parseTokenAmount("0.0000001", 6), null);
  assert.equal(parseTokenAmount("abc", 6), null);
  assert.equal(formatTokenAmount(10_000_000n, 9), "0.01");
  assert.equal(formatTokenAmount(1_000_500_000n, 6), "1000.5");
});

test("build input is allowlisted, base58-validated and mode-aware", () => {
  const deposit = validateKaminoBuildInput({ mode: "deposit", wallet: PROBE, vault: SOL_VAULT, amount: "0.01" });
  assert.equal(deposit.amountRaw, 10_000_000n);
  assert.equal(deposit.amount, "0.01");

  const withdraw = validateKaminoBuildInput({ mode: "withdraw", wallet: PROBE, vault: SOL_VAULT, amount: "0.01" });
  assert.equal(withdraw.amountRaw, 10_000_000n);

  assert.throws(
    () => validateKaminoBuildInput({ mode: "deposit", wallet: PROBE, vault: "unknown", amount: "1" }),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "unknown_vault",
  );
  assert.throws(
    () => validateKaminoBuildInput({ mode: "deposit", wallet: "0xdeadbeef", vault: SOL_VAULT, amount: "1" }),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "invalid_wallet",
  );
  assert.throws(
    () => validateKaminoBuildInput({ mode: "deposit", wallet: PROBE, vault: SOL_VAULT, amount: "0.0000000001" }),
    (error: unknown) => error instanceof KaminoLiveError && error.code === "invalid_amount",
  );
});

test("the Kamino API request uses the human amount and curated vault", () => {
  const request = kaminoApiRequest({ mode: "deposit", wallet: PROBE, vault: SOL_VAULT, amount: "0.01" });
  assert.equal(request.url, "https://api.kamino.finance/ktx/kvault/deposit");
  assert.deepEqual(request.body, { wallet: PROBE, kvault: SOL_VAULT, amount: "0.01" });
});

test("a SOL deposit decodes as wrap + kVault deposit with no hidden Kamino fee", () => {
  const review = summarizeKaminoTransaction(DEPOSIT_TX);
  assert.equal(review.feePayer, PROBE);
  assert.equal(review.signatures, 1);
  assert.equal(review.hasKaminoDeposit, true);
  assert.equal(review.hasKaminoWithdraw, false);
  assert.equal(review.networkFeeLamports, 5_000n);
  assert.equal(review.priorityFeeLamports, 0n);
  assert.equal(review.tokenAccountCreations, 2);
  assert.equal(review.tokenAccountRentLamports, 2n * 2_039_280n);
  assert.equal(review.transferredLamports, 10_000_000n);
  const labels = review.instructions.map((ix) => ix.instruction).join(" | ");
  assert.match(labels, /sync native/);
  assert.match(labels, /kVault deposit/);
  assert.ok(review.instructions.some((ix) => ix.programLabel === "Kamino kVault"));
});

test("a withdraw decodes as kVault withdraw + close wSOL account", () => {
  const review = summarizeKaminoTransaction(WITHDRAW_TX);
  assert.equal(review.feePayer, PROBE);
  assert.equal(review.hasKaminoWithdraw, true);
  assert.equal(review.hasKaminoDeposit, false);
  assert.equal(review.tokenAccountCreations, 1);
  assert.ok(review.instructions.some((ix) => /close token account/.test(ix.instruction)));
});

test("a partial withdraw built as withdraw_from_available passes the pre-sign guard", () => {
  const review = withdrawFromAvailableReview();
  assert.equal(review.lookupsResolved, true);
  assert.equal(review.feePayer, PROBE);
  assert.equal(review.signatures, 1);
  assert.equal(review.hasKaminoWithdraw, true);
  assert.equal(review.hasKaminoDeposit, false);
  assert.equal(review.kaminoAction?.amountRaw, SHARE_AMOUNT);
  assert.equal(review.instructions.filter((ix) => ix.withdrawFromAvailable).length, 1);
  assert.match(
    review.instructions.map((ix) => ix.instruction).join(" | "),
    /withdraw_from_available/,
  );
  assert.doesNotThrow(() => assertKaminoTransactionMatches(review, withdrawExpectation()));
});

test("withdraw_from_available refuses a wrong fee payer or owner", () => {
  assert.throws(
    () =>
      assertKaminoTransactionMatches(
        withdrawFromAvailableReview(),
        withdrawExpectation({ feePayer: FOREIGN_OWNER }),
      ),
    rejectsWith("wrong_fee_payer"),
  );
  assert.throws(
    () =>
      assertKaminoTransactionMatches(
        reviewWithWithdrawAccount(0, FOREIGN_OWNER),
        withdrawExpectation(),
      ),
    rejectsWith("wrong_recipient"),
  );
});

test("withdraw_from_available refuses a different vault", () => {
  assert.throws(
    () =>
      assertKaminoTransactionMatches(
        reviewWithWithdrawAccount(1, OTHER_VAULT),
        withdrawExpectation(),
      ),
    rejectsWith("wrong_vault"),
  );
  assert.throws(
    () =>
      assertKaminoTransactionMatches(
        withdrawFromAvailableReview(),
        withdrawExpectation({ vault: findKaminoVault(OTHER_VAULT)! }),
      ),
    rejectsWith("wrong_vault"),
  );
});

test("withdraw_from_available refuses positional account swaps", () => {
  const cases: { index: number; value: string; code: string }[] = [
    { index: 2, value: FOREIGN_OWNER, code: "wrong_program" }, // global config
    { index: 3, value: FOREIGN_OWNER, code: "unexpected_transfer" }, // vault token account
    { index: 4, value: FOREIGN_OWNER, code: "wrong_vault" }, // base vault authority
    { index: 5, value: FOREIGN_OWNER, code: "wrong_recipient" }, // user asset ATA
    { index: 6, value: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", code: "mint_mismatch" },
    { index: 7, value: FOREIGN_OWNER, code: "wrong_recipient" }, // user share ATA
    { index: 8, value: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", code: "mint_mismatch" },
    { index: 11, value: FOREIGN_OWNER, code: "wrong_program" }, // klend program
    { index: 12, value: FOREIGN_OWNER, code: "wrong_program" }, // event authority
    { index: 13, value: FOREIGN_OWNER, code: "wrong_program" }, // kVault program
  ];
  for (const entry of cases) {
    assert.throws(
      () =>
        assertKaminoTransactionMatches(
          reviewWithWithdrawAccount(entry.index, entry.value),
          withdrawExpectation(),
        ),
      rejectsWith(entry.code),
      `account ${entry.index} swap should fail`,
    );
  }
});

test("withdraw_from_available pins the share token program from curated metadata", () => {
  const expectation = withdrawExpectation();
  const review = withdrawFromAvailableReview();
  const expectedSharesAta = deriveAssociatedTokenAddress(
    expectation.feePayer,
    expectation.vault.sharesMint,
    TOKEN_2022_PROGRAM_ID,
  );
  const instructions = review.instructions.map((instruction) =>
    instruction.withdrawFromAvailable
      ? {
          ...instruction,
          accounts: instruction.accounts.map((account, index) => {
            if (index === 10) return TOKEN_2022_PROGRAM_ID;
            if (index === 7) return expectedSharesAta;
            return account;
          }),
        }
      : instruction,
  );
  assert.throws(
    () => assertKaminoTransactionMatches({ ...review, instructions }, expectation),
    rejectsWith("wrong_program"),
  );
});

test("withdraw_from_available requires the fixed IDL account prefix", () => {
  const review = withdrawFromAvailableReview();
  const instructions = review.instructions.map((instruction) =>
    instruction.withdrawFromAvailable
      ? { ...instruction, accounts: instruction.accounts.slice(0, 13) }
      : instruction,
  );
  assert.throws(
    () => assertKaminoTransactionMatches({ ...review, instructions }, withdrawExpectation()),
    rejectsWith("wrong_instruction"),
  );
});

test("withdraw_from_available refuses an amount above the share balance", () => {
  assert.throws(
    () =>
      assertKaminoTransactionMatches(
        withdrawFromAvailableReview(),
        withdrawExpectation({ positionSharesRaw: SHARE_AMOUNT - 1n }),
      ),
    rejectsWith("wrong_amount"),
  );
  assert.throws(
    () =>
      assertKaminoTransactionMatches(
        withdrawFromAvailableReview(),
        withdrawExpectation({ positionSharesRaw: undefined }),
      ),
    rejectsWith("position_unavailable"),
  );
});

test("withdraw_from_available is refused in deposit mode", () => {
  assert.throws(
    () =>
      assertKaminoTransactionMatches(
        withdrawFromAvailableReview(),
        withdrawExpectation({ mode: "deposit" }),
      ),
    rejectsWith("wrong_instruction"),
  );
});

test("two kVault actions are refused", () => {
  const review = withdrawFromAvailableReview();
  const withdrawInstruction = review.instructions.find((ix) => ix.withdrawFromAvailable);
  assert.ok(withdrawInstruction);
  assert.throws(
    () =>
      assertKaminoTransactionMatches(
        { ...review, instructions: [...review.instructions, withdrawInstruction] },
        withdrawExpectation(),
      ),
    rejectsWith("wrong_instruction"),
  );
});

test("decoding is browser-safe and rejects garbage", () => {
  assert.deepEqual([...base64ToBytes("AQID")], [1, 2, 3]);
  assert.ok(decodeKaminoTransaction(DEPOSIT_TX).message);
  assert.throws(() => summarizeKaminoTransaction("not-base64!!"), (error: unknown) => error instanceof KaminoLiveError);
});

test("estimates are estimates, not quotes", () => {
  const deposit = deriveKaminoEstimate(10_000_000n, "deposit", "1.0563585818443082452", 9);
  assert.equal(deposit.estimateUnit, "shares");
  assert.match(deposit.estimate ?? "", /^0\.00946/);
  const withdraw = deriveKaminoEstimate(10_000_000n, "withdraw", "1.0563585818443082452", 9);
  assert.equal(withdraw.estimateUnit, "tokens");
  assert.match(withdraw.estimate ?? "", /^0\.0105/);
  assert.equal(deriveKaminoEstimate(1n, "deposit", null, 9).estimate, null);
});

test("positions are filtered to the curated vaults and parsed exactly", () => {
  const rows = parseKaminoPositions([
    { vaultAddress: SOL_VAULT, stakedShares: "663.102723", unstakedShares: "0", totalShares: "663.102723" },
    { vaultAddress: "unknown-vault", totalShares: "5" },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.vaultName, "SOL Balanced");
  assert.equal(rows[0]!.shares, "663.102723");
  assert.equal(rows[0]!.sharesRaw, 663_102_723_000n);
});

test("display helpers never invent a number", () => {
  assert.equal(formatLamports(5_000n), "0.000005");
  assert.equal(apyPercent("0.039689144110541585"), "3.97%");
  assert.equal(apyPercent(null), null);
  assert.equal(apyPercent("nope"), null);
  assert.equal(findKaminoVault(SOL_VAULT)?.name, "SOL Balanced");
  assert.equal(findKaminoVault("0xdead"), null);
  assert.equal(KAMINO_VAULTS.length, 2);
});
