import type { EIP1193Provider } from "viem";

export type InjectedProvider = EIP1193Provider & {
  isMetaMask?: true;
  isPhantom?: true;
  providers?: InjectedProvider[];
};

export interface Eip6963ProviderInfo {
  uuid?: string;
  name?: string;
  rdns?: string;
}

export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: InjectedProvider;
}

export interface EthereumWindowLike {
  ethereum?: InjectedProvider;
  phantom?: { ethereum?: InjectedProvider };
}

export type MetaMaskProviderSource = "eip6963" | "providers" | "ethereum";

export interface SelectedMetaMaskProvider {
  provider: InjectedProvider;
  source: MetaMaskProviderSource;
}

export const METAMASK_RDNS = "io.metamask";

function isPhantom(provider: InjectedProvider | undefined): boolean {
  return provider?.isPhantom === true;
}

function isMetaMask(provider: InjectedProvider | undefined): provider is InjectedProvider {
  return provider?.isMetaMask === true && !isPhantom(provider);
}

export function selectMetaMaskProvider(input: {
  announcements?: readonly Eip6963ProviderDetail[];
  ethereum?: InjectedProvider;
  phantom?: { ethereum?: InjectedProvider };
}): SelectedMetaMaskProvider | null {
  const announced = (input.announcements ?? []).find(
    (detail) =>
      detail.info.rdns?.toLowerCase() === METAMASK_RDNS && isMetaMask(detail.provider),
  );
  if (announced) return { provider: announced.provider, source: "eip6963" };

  const ethereum = input.ethereum;
  const fromProviders = ethereum?.providers?.find(isMetaMask);
  if (fromProviders) return { provider: fromProviders, source: "providers" };

  const phantomOwnsEthereum =
    isPhantom(ethereum) || (input.phantom?.ethereum !== undefined && input.phantom.ethereum === ethereum);
  if (isMetaMask(ethereum) && !phantomOwnsEthereum) {
    return { provider: ethereum, source: "ethereum" };
  }

  return null;
}

const listeners = new Set<() => void>();
let installed = false;
let announcements: Eip6963ProviderDetail[] = [];

function notify(): void {
  for (const listener of listeners) listener();
}

function onAnnounce(event: Event): void {
  const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
  if (!detail?.info || !detail.provider) return;
  const duplicate = announcements.some(
    (entry) =>
      (detail.info.uuid && entry.info.uuid === detail.info.uuid) ||
      (detail.info.rdns && entry.info.rdns === detail.info.rdns && entry.provider === detail.provider),
  );
  if (duplicate) return;
  announcements = [...announcements, detail];
  notify();
}

function ensureListening(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.addEventListener("ethereum#initialized", notify);
}

function requestAnnouncements(): void {
  ensureListening();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function subscribeMetaMaskProvider(listener: () => void): () => void {
  ensureListening();
  listeners.add(listener);
  requestAnnouncements();
  return () => {
    listeners.delete(listener);
  };
}

function currentWindow(): EthereumWindowLike | undefined {
  if (typeof window === "undefined") return undefined;
  return window as unknown as EthereumWindowLike;
}

export function resolveMetaMaskProvider(): InjectedProvider | null {
  ensureListening();
  const win = currentWindow();
  if (!win) return null;
  return (
    selectMetaMaskProvider({
      announcements,
      ethereum: win.ethereum,
      phantom: win.phantom,
    })?.provider ?? null
  );
}

export function requestMetaMaskProvider(): InjectedProvider | null {
  requestAnnouncements();
  return resolveMetaMaskProvider();
}

export function metaMaskAvailableSnapshot(): boolean {
  return resolveMetaMaskProvider() !== null;
}

export function metaMaskServerSnapshot(): boolean {
  return false;
}
