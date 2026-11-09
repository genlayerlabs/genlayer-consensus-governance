/**
 * Deployment folders published by genlayerlabs/genlayer-networks.
 *
 * The repository keeps one folder per deployment (`<name>/testnet_deployments.json`)
 * and an `index.json` listing them newest first, rebuilt by its own workflow on
 * every push to `main`. The UI reads both straight from raw.githubusercontent.com,
 * so a new deployment shows up in the selector as soon as its folder lands.
 */

export const NETWORKS_REPO = {
  owner: "genlayerlabs",
  repo: "genlayer-networks",
  branch: "main",
} as const;

const RAW_BASE = `https://raw.githubusercontent.com/${NETWORKS_REPO.owner}/${NETWORKS_REPO.repo}/${NETWORKS_REPO.branch}/`;
const API_BASE = `https://api.github.com/repos/${NETWORKS_REPO.owner}/${NETWORKS_REPO.repo}/`;
const BOOK_FILE = "testnet_deployments.json";

/** One folder of the repository, as listed in index.json. */
export interface NetworkDeployment {
  /** Folder name: the stable identifier stored in the browser */
  name: string;
  /** Selector label derived from the folder name ("bradbury-phase-2" reads "Bradbury Phase 2") */
  label: string;
  path: string;
  /** Repository path of the deployment book */
  book: string;
  abi: string | null;
  readme: string | null;
  /** Top-level key of the book: "genlayerOrbitTestnet", "genlayerTestnet", … */
  network: string;
  /** Deployment set key inside the book: "deployment_bradbury_phase_2", … */
  set: string;
  addressManager: `0x${string}`;
  /** genlayer-consensus commit the deployment was built from (the folder's COMMIT file) */
  consensusCommit: string | null;
  /** When the folder's book was first committed; the index is ordered by it, newest first */
  createdAt: string | null;
  updatedAt: string | null;
}

export interface NetworksIndex {
  repository: string;
  generatedAt: string;
  commit: string;
  /** Newest folder first */
  deployments: NetworkDeployment[];
}

/** Deployment book as written by genlayer-consensus: network key, then deployment set, then addresses. */
export type DeploymentBook = Record<string, Record<string, Record<string, string>>>;

export interface FetchOptions {
  /** Bypass the HTTP cache (the refresh button); raw.githubusercontent.com caches for up to five minutes otherwise */
  fresh?: boolean;
  signal?: AbortSignal;
}

export function rawUrl(path: string): string {
  return RAW_BASE + path.replace(/^\/+/, "");
}

export function repoUrl(path = ""): string {
  return `https://github.com/${NETWORKS_REPO.owner}/${NETWORKS_REPO.repo}${path ? `/tree/${NETWORKS_REPO.branch}/${path}` : ""}`;
}

export function labelFromName(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const target = opts.fresh ? `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}` : url;
  const res = await fetch(target, { cache: opts.fresh ? "no-store" : "default", signal: opts.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** Find the (network, set, addresses) triple of a book: the set that holds an AddressManager. */
export function extractBookSet(
  book: unknown,
): { network: string; set: string; addresses: Record<string, string> } | null {
  if (!book || typeof book !== "object") return null;
  for (const [network, sets] of Object.entries(book as Record<string, unknown>)) {
    if (!sets || typeof sets !== "object") continue;
    for (const [set, addresses] of Object.entries(sets as Record<string, unknown>)) {
      if (addresses && typeof addresses === "object" && "AddressManager" in addresses) {
        return { network, set, addresses: addresses as Record<string, string> };
      }
    }
  }
  return null;
}

function isDeployment(value: unknown): value is NetworkDeployment {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return typeof d.name === "string" && typeof d.book === "string" && typeof d.addressManager === "string";
}

/**
 * Fallback when index.json cannot be read: list the top-level folders through
 * the GitHub contents API and read each book. Without the index there are no
 * commit dates, so the folders come back in name order.
 */
async function listFoldersWithoutIndex(opts: FetchOptions): Promise<NetworksIndex> {
  const entries = await fetchJson<Array<{ name: string; type: string }>>(
    `${API_BASE}contents?ref=${NETWORKS_REPO.branch}`,
    opts,
  );
  const folders = entries.filter((e) => e.type === "dir" && !e.name.startsWith(".")).map((e) => e.name);
  const deployments = await Promise.all(
    folders.map(async (name): Promise<NetworkDeployment | null> => {
      try {
        const book = await fetchJson<unknown>(rawUrl(`${name}/${BOOK_FILE}`), opts);
        const found = extractBookSet(book);
        if (!found) return null;
        return {
          name,
          label: labelFromName(name),
          path: name,
          book: `${name}/${BOOK_FILE}`,
          abi: null,
          readme: null,
          network: found.network,
          set: found.set,
          addressManager: found.addresses.AddressManager as `0x${string}`,
          consensusCommit: null,
          createdAt: null,
          updatedAt: null,
        };
      } catch {
        return null; // a folder without a book is not a deployment
      }
    }),
  );
  return {
    repository: `${NETWORKS_REPO.owner}/${NETWORKS_REPO.repo}`,
    generatedAt: new Date().toISOString(),
    commit: "",
    deployments: deployments.filter((d): d is NetworkDeployment => d !== null),
  };
}

/** The deployment list, newest first. Falls back to a folder listing when index.json is unavailable. */
export async function fetchNetworksIndex(opts: FetchOptions = {}): Promise<NetworksIndex> {
  let indexError: unknown;
  try {
    const index = await fetchJson<NetworksIndex>(rawUrl("index.json"), opts);
    if (!Array.isArray(index.deployments)) throw new Error("index.json has no deployments array");
    return { ...index, deployments: index.deployments.filter(isDeployment) };
  } catch (e) {
    indexError = e;
  }
  try {
    return await listFoldersWithoutIndex(opts);
  } catch (e) {
    const first = indexError instanceof Error ? indexError.message : String(indexError);
    const second = e instanceof Error ? e.message : String(e);
    throw new Error(`Could not list the deployments of ${NETWORKS_REPO.owner}/${NETWORKS_REPO.repo}: ${first}; ${second}`);
  }
}

/** The deployment book of one folder. */
export function fetchDeploymentBook(deployment: NetworkDeployment, opts: FetchOptions = {}): Promise<DeploymentBook> {
  return fetchJson<DeploymentBook>(rawUrl(deployment.book), opts);
}

/**
 * Which folder to show: the one remembered in the browser when it still exists,
 * otherwise the newest one (the first entry of the index).
 */
export function pickDeployment(index: NetworksIndex, storedName: string | null | undefined): NetworkDeployment | undefined {
  if (storedName) {
    const stored = index.deployments.find((d) => d.name === storedName);
    if (stored) return stored;
  }
  return index.deployments[0];
}

/** localStorage access that survives private windows and blocked storage. */
export const storedValue = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // storage unavailable: the choice simply is not remembered
    }
  },
};
