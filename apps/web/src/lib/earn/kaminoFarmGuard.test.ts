import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MessageV0,
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  KAMINO_FARMS_PROGRAM_ID,
  KAMINO_KVAULT_PROGRAM_ID,
  KaminoLiveError,
  assertKaminoTransactionMatches,
  deriveAssociatedTokenAddress,
  findKaminoVault,
  summarizeKaminoTransaction,
  type KaminoInstructionSummary,
  type KaminoLookupAddresses,
  type KaminoTransactionExpectation,
  type KaminoTxReview,
  type KaminoVaultMeta,
} from "./kaminoLive.ts";

/**
 * Fixtures captured from public Solana mainnet transactions (no secrets, signatures zeroed):
 * - withdraw 3yNBmWZ23CAwa7dGi8dpkRACX8CKeGUsb8grai8KydkqSSgZmLwLRwPwyJwLveBwGvbEgU2sf8mE2tqeyKnXh2YQ
 * - deposit  3cgt69V2GvTC5WGhxnZ7xupeCVSBMv1KnLXWcjhPxnQdwVhNTJ2dd212YggmHwLoYDvgN3Pfw8fPE4XxHrPdWMGC
 * They carry the real Kamino farms account layouts for the SOL Balanced vault.
 */
interface FixtureTx {
  readonly transaction: string;
  readonly lookupAddresses: KaminoLookupAddresses;
}

interface FarmFixture {
  readonly wallet: string;
  readonly vaultFarm: string;
  readonly sharesMint: string;
  readonly withdraw: FixtureTx;
  readonly deposit: FixtureTx;
}

const FIXTURE = JSON.parse(
  readFileSync(new URL("./__fixtures__/kamino-farms-mainnet.json", import.meta.url), "utf8"),
) as FarmFixture;

const SOL_VAULT = "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg";
const SOL_TOKEN_VAULT = "3Q9MzRtQaPtmydXUMVYqz6WTGSLFCGbs929mXTXTziw4";
const WALLET = FIXTURE.wallet;
const VAULT_FARM = FIXTURE.vaultFarm;
const SOL_META: KaminoVaultMeta = findKaminoVault(SOL_VAULT)!;

function expectation(
  overrides: Partial<KaminoTransactionExpectation> = {},
): KaminoTransactionExpectation {
  return {
    feePayer: WALLET,
    mode: "deposit",
    vault: SOL_META,
    amountRaw: 10_000_000n,
    tokenVault: SOL_TOKEN_VAULT,
    vaultFarm: VAULT_FARM,
    ...overrides,
  };
}

function summarize(fixture: FixtureTx): KaminoTxReview {
  return summarizeKaminoTransaction(fixture.transaction, {
    lookupAddresses: fixture.lookupAddresses,
  });
}

function errorCode(run: () => void): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof KaminoLiveError) return error.code;
    throw error;
  }
}

/** Clone a review replacing the accounts of the first farm instruction of `kind`. */
function withFarmAccounts(
  review: KaminoTxReview,
  kind: string,
  mutate: (accounts: readonly string[]) => readonly string[],
): KaminoTxReview {
  let done = false;
  return {
    ...review,
    instructions: review.instructions.map((instruction) => {
      if (!done && instruction.farmKind === kind) {
        done = true;
        return { ...instruction, accounts: mutate(instruction.accounts) };
      }
      return instruction;
    }),
  };
}

function buildTransaction(payer: string, instructions: TransactionInstruction[]): string {
  const message = MessageV0.compile({
    payerKey: new PublicKey(payer),
    recentBlockhash: "11111111111111111111111111111111",
    instructions,
  });
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

const attacker = new PublicKey("Vote111111111111111111111111111111111111111").toBase58();

test("real mainnet withdraw (unstake + withdraw-unstaked) passes the guard", () => {
  const review = summarize(FIXTURE.withdraw);
  assert.equal(review.feePayer, WALLET);
  assert.equal(review.lookupsResolved, true);
  const kinds = review.instructions
    .filter((instruction) => instruction.programId === KAMINO_FARMS_PROGRAM_ID)
    .map((instruction) => instruction.farmKind);
  assert.deepEqual(kinds, ["unstake", "withdraw_unstaked"]);
  assert.equal(
    errorCode(() =>
      assertKaminoTransactionMatches(
        review,
        expectation({ mode: "withdraw", amountRaw: 10_000_000n, positionSharesRaw: 10_000_000n }),
      ),
    ),
    null,
  );
});

test("real mainnet deposit (initialize + stake) passes the guard", () => {
  const review = summarize(FIXTURE.deposit);
  assert.equal(review.feePayer, WALLET);
  assert.equal(review.lookupsResolved, true);
  const kinds = review.instructions
    .filter((instruction) => instruction.programId === KAMINO_FARMS_PROGRAM_ID)
    .map((instruction) => instruction.farmKind);
  assert.deepEqual(kinds, ["initialize_user", "stake"]);
  assert.equal(errorCode(() => assertKaminoTransactionMatches(review, expectation())), null);
});

test("a farm instruction for a different owner is refused", () => {
  const review = summarize(FIXTURE.deposit);
  const tampered = withFarmAccounts(review, "initialize_user", (accounts) => {
    const next = [...accounts];
    next[2] = attacker; // owner
    return next;
  });
  assert.equal(
    errorCode(() => assertKaminoTransactionMatches(tampered, expectation())),
    "wrong_recipient",
  );

  const stakeOwner = withFarmAccounts(review, "stake", (accounts) => {
    const next = [...accounts];
    next[0] = attacker; // owner (signer)
    return next;
  });
  assert.equal(
    errorCode(() => assertKaminoTransactionMatches(stakeOwner, expectation())),
    "wrong_recipient",
  );
});

test("a farm instruction for a different farm is refused", () => {
  const review = summarize(FIXTURE.deposit);
  const tampered = withFarmAccounts(review, "stake", (accounts) => {
    const next = [...accounts];
    next[2] = attacker; // farm_state
    return next;
  });
  assert.equal(
    errorCode(() => assertKaminoTransactionMatches(tampered, expectation())),
    "wrong_vault",
  );
});

test("withdraw-unstaked to a foreign token account is refused", () => {
  const review = summarize(FIXTURE.withdraw);
  const foreignAta = deriveAssociatedTokenAddress(attacker, SOL_META.sharesMint);
  const tampered = withFarmAccounts(review, "withdraw_unstaked", (accounts) => {
    const next = [...accounts];
    next[3] = foreignAta; // user token account
    return next;
  });
  assert.equal(
    errorCode(() =>
      assertKaminoTransactionMatches(
        tampered,
        expectation({ mode: "withdraw", amountRaw: 10_000_000n, positionSharesRaw: 10_000_000n }),
      ),
    ),
    "wrong_recipient",
  );
});

test("a non-canonical user_state PDA is refused", () => {
  const review = summarize(FIXTURE.deposit);
  const [foreignUserState] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("user"),
      new PublicKey(VAULT_FARM).toBuffer(),
      new PublicKey(attacker).toBuffer(),
    ],
    new PublicKey(KAMINO_FARMS_PROGRAM_ID),
  );
  const tampered = withFarmAccounts(review, "stake", (accounts) => {
    const next = [...accounts];
    next[1] = foreignUserState.toBase58();
    return next;
  });
  assert.equal(
    errorCode(() => assertKaminoTransactionMatches(tampered, expectation())),
    "wrong_recipient",
  );
});

test("an unknown Kamino farms discriminator is refused at decode", () => {
  const transaction = buildTransaction(WALLET, [
    new TransactionInstruction({
      programId: new PublicKey(KAMINO_FARMS_PROGRAM_ID),
      keys: [{ pubkey: new PublicKey(WALLET), isSigner: true, isWritable: true }],
      data: Buffer.from("deadbeefdeadbeef", "hex"),
    }),
  ]);
  const review = summarizeKaminoTransaction(transaction);
  assert.equal(
    errorCode(() => assertKaminoTransactionMatches(review, expectation())),
    "authority_change",
  );
});

test("a stake instruction is only allowed in a deposit flow", () => {
  const withdrawReview = summarize(FIXTURE.withdraw);
  const depositReview = summarize(FIXTURE.deposit);
  const stakeInstruction = depositReview.instructions.find(
    (instruction: KaminoInstructionSummary) => instruction.farmKind === "stake",
  );
  assert.ok(stakeInstruction);
  const tampered: KaminoTxReview = {
    ...withdrawReview,
    instructions: [...withdrawReview.instructions, stakeInstruction],
  };
  assert.equal(
    errorCode(() =>
      assertKaminoTransactionMatches(
        tampered,
        expectation({ mode: "withdraw", amountRaw: 10_000_000n, positionSharesRaw: 10_000_000n }),
      ),
    ),
    "wrong_instruction",
  );
});

test("a vault without a farm refuses farm instructions", () => {
  const review = summarize(FIXTURE.deposit);
  assert.equal(
    errorCode(() => assertKaminoTransactionMatches(review, expectation({ vaultFarm: null }))),
    "wrong_vault",
  );
});

test("a wrong token mint on the stake instruction is refused", () => {
  const review = summarize(FIXTURE.deposit);
  const tampered = withFarmAccounts(review, "stake", (accounts) => {
    const next = [...accounts];
    next[5] = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC mint
    return next;
  });
  assert.equal(
    errorCode(() => assertKaminoTransactionMatches(tampered, expectation())),
    "mint_mismatch",
  );
});

test("the fixture really targets the selected kVault program", () => {
  const review = summarize(FIXTURE.deposit);
  assert.ok(
    review.instructions.some((instruction) => instruction.programId === KAMINO_KVAULT_PROGRAM_ID),
  );
});
