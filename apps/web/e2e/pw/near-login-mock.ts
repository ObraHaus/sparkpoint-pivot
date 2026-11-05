/**
 * 076 — a NEAR wallet mock that produces REAL NEP-413 signatures with a throwaway ed25519 key
 * generated at test time.
 *
 * The key never leaves Node. The browser mock calls an exposed bridge that borsh-encodes the
 * NEP-413 payload and signs it, exactly as a real NEAR wallet would. The server still verifies the
 * signature; only the on-chain "is this key on the account" lookup is skipped by the explicit,
 * server-env-gated test mode (`NEAR_LOGIN_TEST_MODE=true`, pinned to `NEAR_LOGIN_TEST_ACCOUNT`).
 *
 * No wallet file is read, no key is persisted, and there is no transaction surface.
 */

import { generateKeyPairSync, sign as edSign } from "node:crypto";
import type { Page } from "@playwright/test";

import { encodeBase58, nep413Digest } from "../../src/lib/near/nep413.ts";

export const NEAR_LOGIN_TEST_ACCOUNT = "sparkpoint2026.near";

export interface NearLoginMockOptions {
  accountId?: string;
}

export interface NearLoginMock {
  publicKey: string;
  accountId: string;
}

export async function installNearLoginMock(
  page: Page,
  { accountId = NEAR_LOGIN_TEST_ACCOUNT }: NearLoginMockOptions = {},
): Promise<NearLoginMock> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const publicKeyString = `ed25519:${encodeBase58(new Uint8Array(rawPublic))}`;

  await page.exposeFunction(
    "__pwNearSign",
    (input: { message: string; recipient: string; nonce: number[] }) => {
      const payload = {
        message: input.message,
        recipient: input.recipient,
        nonce: Uint8Array.from(input.nonce),
      };
      const signature = edSign(null, Buffer.from(nep413Digest(payload)), privateKey);
      return {
        accountId,
        publicKey: publicKeyString,
        // NEP-413 output: the signature is base64, not a curve:base58 key.
        signature: Buffer.from(signature).toString("base64"),
      };
    },
  );

  await page.addInitScript(
    ({ accountId, publicKey }: { accountId: string; publicKey: string }) => {
      type SignInput = { message: string; recipient: string; nonce: number[] };
      const state = { connected: false };
      const mock = {
        async connect() {
          state.connected = true;
          return { accountId, publicKey };
        },
        async disconnect() {
          state.connected = false;
        },
        async getAccount() {
          return state.connected ? { accountId, publicKey } : null;
        },
        async signMessage(input: SignInput) {
          return (
            window as unknown as {
              __pwNearSign: (i: SignInput) => Promise<{ accountId: string; publicKey: string; signature: string }>;
            }
          ).__pwNearSign({
            message: input.message,
            recipient: input.recipient,
            nonce: Array.from(input.nonce),
          });
        },
        async signAndSendTransaction() {
          throw new Error("signAndSendTransaction must never be called");
        },
        async signTransaction() {
          throw new Error("signTransaction must never be called");
        },
      };
      (window as unknown as { __SP_NEAR_WALLET_MOCK__: typeof mock }).__SP_NEAR_WALLET_MOCK__ = mock;
    },
    { accountId, publicKey: publicKeyString },
  );

  return { publicKey: publicKeyString, accountId };
}
