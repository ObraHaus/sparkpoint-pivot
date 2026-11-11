import { test } from "node:test";
import assert from "node:assert/strict";
import {
  METAMASK_RDNS,
  selectMetaMaskProvider,
  type Eip6963ProviderDetail,
  type InjectedProvider,
} from "./metamaskProvider.ts";

function provider(flags: Record<string, unknown> = {}): InjectedProvider {
  return {
    request: async () => null,
    ...flags,
  } as unknown as InjectedProvider;
}

function announcement(rdns: string, p: InjectedProvider): Eip6963ProviderDetail {
  return {
    info: { uuid: `${rdns}-uuid`, name: rdns, rdns },
    provider: p,
  };
}

const metaMask = provider({ isMetaMask: true });
const phantom = provider({ isPhantom: true });
const phantomSpoof = provider({ isMetaMask: true, isPhantom: true });

test("an EIP-6963 io.metamask announcement wins over window.ethereum and providers[]", () => {
  const otherMetaMask = provider({ isMetaMask: true });
  const selected = selectMetaMaskProvider({
    announcements: [announcement("app.phantom", phantom), announcement(METAMASK_RDNS, metaMask)],
    ethereum: phantom,
    phantom: { ethereum: phantom },
  });

  assert.equal(selected?.source, "eip6963");
  assert.equal(selected?.provider, metaMask);
  assert.notEqual(selected?.provider, otherMetaMask);
});

test("a non-MetaMask announcement is ignored and providers[] is used as the fallback", () => {
  const selected = selectMetaMaskProvider({
    announcements: [announcement("app.phantom", phantom)],
    ethereum: provider({ providers: [phantomSpoof, metaMask] }),
    phantom: { ethereum: phantom },
  });

  assert.equal(selected?.source, "providers");
  assert.equal(selected?.provider, metaMask);
});

test("a Phantom announcement cannot win even when it spoofs isMetaMask", () => {
  const selected = selectMetaMaskProvider({
    announcements: [announcement(METAMASK_RDNS, phantomSpoof)],
    ethereum: provider({ providers: [metaMask] }),
  });

  assert.equal(selected?.source, "providers");
  assert.equal(selected?.provider, metaMask);
});

test("a bare window.ethereum is accepted only when it is MetaMask and not Phantom", () => {
  const selected = selectMetaMaskProvider({ ethereum: metaMask });
  assert.equal(selected?.source, "ethereum");
  assert.equal(selected?.provider, metaMask);
});

test("Phantom-owned window.ethereum is rejected even when it spoofs isMetaMask", () => {
  assert.equal(selectMetaMaskProvider({ ethereum: phantomSpoof }), null);
  assert.equal(selectMetaMaskProvider({ ethereum: phantom }), null);
});

test("window.ethereum that is the Phantom instance is rejected without an isPhantom flag", () => {
  const spoof = provider({ isMetaMask: true });
  assert.equal(selectMetaMaskProvider({ ethereum: spoof, phantom: { ethereum: spoof } }), null);
});

test("not detected when no announced or injected MetaMask provider exists", () => {
  assert.equal(
    selectMetaMaskProvider({
      announcements: [announcement("app.phantom", phantom)],
      ethereum: phantom,
      phantom: { ethereum: phantom },
    }),
    null,
  );
  assert.equal(selectMetaMaskProvider({}), null);
});
