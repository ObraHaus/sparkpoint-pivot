/**
 * Pure session-key UserOp signer (US6, feature 022) — no React, no wallet, no storage.
 *
 * Signs the agent-built, UNSIGNED ERC-4337 v0.7 UserOp (`signature: null`, N3) with the CLIENT's
 * session key so an approved, in-scope move executes with NO per-move wallet signature. The service
 * never holds this key; it only builds the op and, on submit, byte-matches `sender`+`callData` (SC-005)
 * before relaying via the bundler.
 *
 * The signature the on-chain `SparkPointAccount.validateUserOp` (→ `SessionScopeLib.recoverSessionSigner`)
 * expects is EXACTLY 66 bytes: `mode(0x01) ‖ r(32) ‖ s(32) ‖ v(1)`, where the recovered digest is the
 * **EIP-191** wrap of the **canonical EntryPoint-v0.7 userOpHash** (`toEthSignedMessageHash(userOpHash)`
 * — NOT the raw hash, NOT EIP-712). This exactly mirrors the contract's proven-live scheme
 * (`vm.sign(pk, toEthSignedMessageHash(entryPoint.getUserOpHash(op)))` + `abi.encodePacked(0x01,r,s,v)`).
 * viem's `getUserOperationHash` (v0.7 branch) reproduces the EntryPoint packing byte-for-byte and pins
 * the same `entryPoint07Address` as the agent — so there is no hand-rolled hashing to drift.
 *
 * Getting the coercion wrong (hex vs bigint, or `null` factory/paymaster vs omitted) silently changes
 * the hash → the bundler returns AA24 (signature error). The `sessionSigner.test.ts` fixture pins the
 * hash against the Solidity fork test so a regression is caught before it reaches a bundler.
 */

import { concat, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { entryPoint07Address, getUserOperationHash } from "viem/account-abstraction";

import type { PackedUserOperation } from "@sparkpoint/shared/schemas";

/** The validator-mode byte the on-chain SessionKeyValidator reads: 0x01 = session-key ECDSA. */
export const SESSION_SIGNATURE_MODE = "0x01" as const;

/** EntryPoint v0.7 singleton — MUST equal the agent's pin (`session_userop.py:ENTRYPOINT`). */
export const ENTRY_POINT_ADDRESS = entryPoint07Address;

/** The agent's unsigned op with the client signature filled — the exact body POSTed to submit. */
export type SignedSessionUserOp = Omit<PackedUserOperation, "signature"> & { signature: Hex };

export interface SignSessionResult {
  /** The op to POST verbatim as `signed.userOp` (same hex fields as the built op + the 66-byte sig). */
  signedUserOp: SignedSessionUserOp;
  /** The canonical EntryPoint-v0.7 userOpHash that was signed (surfaced for tests + diagnostics). */
  userOpHash: Hex;
}

/** A nullable hex field → `undefined` (so viem's initCode/paymasterAndData hash as `0x`, not a null). */
function orUndefined(value: string | null): Hex | undefined {
  return value ? (value as Hex) : undefined;
}

/**
 * Compute the canonical EntryPoint-v0.7 `userOpHash` for the agent's built op. Exported so the unit
 * test can assert it equals `entryPoint.getUserOpHash(op)` from the Solidity fork test (AA24 guard).
 */
export function sessionUserOpHash(userOp: PackedUserOperation, chainId: number): Hex {
  return getUserOperationHash({
    chainId,
    entryPointAddress: ENTRY_POINT_ADDRESS,
    entryPointVersion: "0.7",
    userOperation: {
      sender: userOp.sender as Hex,
      nonce: BigInt(userOp.nonce),
      callData: userOp.callData as Hex,
      callGasLimit: BigInt(userOp.callGasLimit),
      verificationGasLimit: BigInt(userOp.verificationGasLimit),
      preVerificationGas: BigInt(userOp.preVerificationGas),
      maxFeePerGas: BigInt(userOp.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(userOp.maxPriorityFeePerGas),
      // null → undefined so a non-deploying / non-sponsored op hashes initCode/paymasterAndData as 0x.
      factory: orUndefined(userOp.factory),
      factoryData: orUndefined(userOp.factoryData),
      paymaster: orUndefined(userOp.paymaster),
      paymasterData: orUndefined(userOp.paymasterData),
      // signature is NOT part of the v0.7 userOpHash; a placeholder keeps the viem type satisfied.
      signature: "0x",
    },
  });
}

/**
 * Sign `userOp` with the session `privateKey` and return the submit-ready op. The op is signed
 * VERBATIM — we do not re-estimate gas or mutate any field — because the agent's `signed_matches_scope`
 * pins `sender`+`callData` and the userOpHash binds every gas/nonce field; the client must sign exactly
 * the op it posts back. No wallet prompt: the session key is a local `LocalAccount`.
 */
export async function signSessionUserOp(
  userOp: PackedUserOperation,
  opts: { chainId: number; privateKey: Hex },
): Promise<SignSessionResult> {
  const userOpHash = sessionUserOpHash(userOp, opts.chainId);
  const account = privateKeyToAccount(opts.privateKey);
  // EIP-191 wrap: signMessage({ raw }) prefixes "\x19Ethereum Signed Message:\n32" before signing —
  // it is the toEthSignedMessageHash the contract recovers over. account.sign({hash}) would OMIT the
  // prefix and produce an AA24 mismatch, so we MUST use signMessage here.
  const sig65 = await account.signMessage({ message: { raw: userOpHash } });
  const signature = concat([SESSION_SIGNATURE_MODE, sig65]); // mode ‖ r ‖ s ‖ v = 66 bytes
  const { signature: _drop, ...rest } = userOp;
  return { signedUserOp: { ...rest, signature }, userOpHash };
}
