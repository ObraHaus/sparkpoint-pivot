import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizesAddress,
  isUnauthorizedProviderError,
  isUserRejectedError,
  readWalletChainId,
  reauthorizeAccounts,
  signSiweWithRecovery,
  type Eip1193ProviderLike,
} from "./siweAuthz.ts";

const A = "0xBddA41D11014FdD9a656386e29Af1a1349f94f13";

type Handler = (params?: unknown[]) => unknown;

/** A scripted EIP-1193 provider that records every method it is asked for. */
function fakeProvider(handlers: Record<string, Handler>): Eip1193ProviderLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async request({ method, params }) {
      calls.push(method);
      const handler = handlers[method];
      if (!handler) throw Object.assign(new Error(`unexpected ${method}`), { code: -32601 });
      return handler(params);
    },
  };
}

test("4100 is recognized from a viem/provider error, its cause chain, and its name", () => {
  assert.equal(isUnauthorizedProviderError(Object.assign(new Error("nope"), { code: 4100 })), true);
  assert.equal(isUnauthorizedProviderError(Object.assign(new Error("nope"), { code: "4100" })), true);
  assert.equal(
    isUnauthorizedProviderError({ message: "wrap", cause: { code: 4100 } }),
    true,
  );
  assert.equal(isUnauthorizedProviderError({ name: "UnauthorizedProviderError" }), true);
});

test("other errors are NOT treated as the recoverable 4100", () => {
  assert.equal(isUnauthorizedProviderError(Object.assign(new Error("no"), { code: 4001 })), false);
  assert.equal(isUnauthorizedProviderError(new Error("plain")), false);
  assert.equal(isUnauthorizedProviderError(undefined), false);
  assert.equal(isUnauthorizedProviderError("4100"), false);
});

test("user rejection (4001) is recognized so it is never auto-retried", () => {
  assert.equal(isUserRejectedError(Object.assign(new Error("no"), { code: 4001 })), true);
  assert.equal(isUserRejectedError({ cause: { name: "UserRejectedRequestError" } }), true);
  assert.equal(isUserRejectedError(Object.assign(new Error("no"), { code: 4100 })), false);
});

test("reauthorizeAccounts requests permission and returns the now-authorized accounts", async () => {
  const provider = fakeProvider({
    wallet_requestPermissions: () => [{ caveats: [{ value: [A] }] }],
    eth_accounts: () => [A],
    eth_requestAccounts: () => [A],
  });

  assert.deepEqual(await reauthorizeAccounts(provider), [A]);
  assert.deepEqual(provider.calls, ["wallet_requestPermissions", "eth_accounts"]);
});

test("a wallet without wallet_requestPermissions still recovers via the account reads", async () => {
  const provider = fakeProvider({
    wallet_requestPermissions: () => {
      throw Object.assign(new Error("method not found"), { code: -32601 });
    },
    eth_accounts: () => [A],
  });

  assert.deepEqual(await reauthorizeAccounts(provider), [A]);
  assert.deepEqual(provider.calls, ["wallet_requestPermissions", "eth_accounts"]);
});

test("when no accounts are exposed it falls back to an explicit eth_requestAccounts", async () => {
  const provider = fakeProvider({
    wallet_requestPermissions: () => [],
    eth_accounts: () => [],
    eth_requestAccounts: () => [A],
  });

  assert.deepEqual(await reauthorizeAccounts(provider), [A]);
  assert.deepEqual(provider.calls, ["wallet_requestPermissions", "eth_accounts", "eth_requestAccounts"]);
});

test("a user rejection of the permission prompt is rethrown, not papered over", async () => {
  const provider = fakeProvider({
    wallet_requestPermissions: () => {
      throw Object.assign(new Error("user rejected"), { code: 4001 });
    },
    eth_accounts: () => [A],
  });

  await assert.rejects(() => reauthorizeAccounts(provider), /user rejected/);
  assert.deepEqual(provider.calls, ["wallet_requestPermissions"]);
});

test("authorizesAddress matches case-insensitively and rejects a different account", () => {
  assert.equal(authorizesAddress([A.toLowerCase()], A), true);
  assert.equal(authorizesAddress([A], A.toUpperCase().replace("0X", "0x")), true);
  assert.equal(authorizesAddress(["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"], A), false);
  assert.equal(authorizesAddress([], A), false);
});

const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BASE_CHAIN_ID = 8453;

test("4100 is recognized even when wrapped twice (error.cause.cause)", () => {
  assert.equal(
    isUnauthorizedProviderError({ message: "wrap", cause: { message: "mid", cause: { code: 4100 } } }),
    true,
  );
});

test("readWalletChainId parses hex and numeric ids and reports an unreadable one as undefined", async () => {
  assert.equal(await readWalletChainId(fakeProvider({ eth_chainId: () => "0x2105" })), BASE_CHAIN_ID);
  assert.equal(await readWalletChainId(fakeProvider({ eth_chainId: () => BASE_CHAIN_ID })), BASE_CHAIN_ID);
  assert.equal(await readWalletChainId(fakeProvider({ eth_chainId: () => "not-a-chain" })), undefined);
});

test("a 4100 retries exactly once with the explicit intended account", async () => {
  const provider = fakeProvider({
    eth_chainId: () => "0x2105",
    wallet_requestPermissions: () => [],
    eth_accounts: () => [A],
  });
  const accountsUsed: string[] = [];
  let attempt = 0;
  const sign = async (args: { message: string; account: `0x${string}` }) => {
    accountsUsed.push(args.account);
    attempt++;
    if (attempt === 1) throw Object.assign(new Error("unauthorized"), { code: 4100 });
    return "0xsig" as `0x${string}`;
  };

  const signature = await signSiweWithRecovery(
    { sign, getProvider: async () => provider },
    { message: "m", address: A, chainId: BASE_CHAIN_ID },
  );

  assert.equal(signature, "0xsig");
  assert.deepEqual(accountsUsed, [A, A]);
});

test("a second 4100 surfaces an error instead of looping", async () => {
  const provider = fakeProvider({
    eth_chainId: () => "0x2105",
    wallet_requestPermissions: () => [],
    eth_accounts: () => [A],
  });
  let attempts = 0;
  const sign = async () => {
    attempts++;
    throw Object.assign(new Error("unauthorized"), { code: 4100 });
  };

  await assert.rejects(
    signSiweWithRecovery({ sign, getProvider: async () => provider }, { message: "m", address: A, chainId: BASE_CHAIN_ID }),
    /unauthorized/,
  );
  assert.equal(attempts, 2);
});

test("a 4001 user rejection is never retried and never prompts", async () => {
  let providerAsked = false;
  let attempts = 0;
  const sign = async () => {
    attempts++;
    throw Object.assign(new Error("user rejected"), { code: 4001 });
  };

  await assert.rejects(
    signSiweWithRecovery(
      {
        sign,
        getProvider: async () => {
          providerAsked = true;
          return undefined;
        },
      },
      { message: "m", address: A, chainId: BASE_CHAIN_ID },
    ),
    /user rejected/,
  );
  assert.equal(attempts, 1);
  assert.equal(providerAsked, false);
});

test("a different authorized account aborts instead of signing as the wrong account", async () => {
  const provider = fakeProvider({
    eth_chainId: () => "0x2105",
    wallet_requestPermissions: () => [],
    eth_accounts: () => [OTHER],
  });
  let attempts = 0;
  const sign = async () => {
    attempts++;
    throw Object.assign(new Error("unauthorized"), { code: 4100 });
  };

  await assert.rejects(
    signSiweWithRecovery({ sign, getProvider: async () => provider }, { message: "m", address: A, chainId: BASE_CHAIN_ID }),
    /different account/,
  );
  assert.equal(attempts, 1);
});

test("a wallet on the wrong chain aborts before prompting or retrying", async () => {
  const provider = fakeProvider({ eth_chainId: () => "0x1" });
  let attempts = 0;
  const sign = async () => {
    attempts++;
    throw Object.assign(new Error("unauthorized"), { code: 4100 });
  };

  await assert.rejects(
    signSiweWithRecovery({ sign, getProvider: async () => provider }, { message: "m", address: A, chainId: BASE_CHAIN_ID }),
    /different network/,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(provider.calls, ["eth_chainId"]);
});
