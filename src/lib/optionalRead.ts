import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, type Abi, type Address } from 'viem'
import { publicClient } from '@/config/clients'

/**
 * A read that may not exist on the deployment being viewed.
 *
 * CON-864 added views (`proposalCount`, `elections`, `electionEconomics`,
 * `actionCount`, the GLF getters…) that an older deployment does not have.
 * The same static build serves both, so every adoption of a new view is a
 * question with three answers, and the difference between the last two is
 * what keeps the UI honest:
 *
 * - `value`   — the view exists and this is what it returned.
 * - `absent`  — the call reverted. A missing selector reverts with empty
 *               data, so on this deployment the view is not there; use the
 *               log/probe workaround the UI has always had.
 * - `unknown` — the node failed for its own reasons. Nothing was learned:
 *               keep the workaround AND say the value could not be read.
 *               Reporting this as "not available on this deployment" would
 *               turn every RPC hiccup into a false claim about the contract.
 */
export type OptionalRead<T> =
  | { value: T }
  | { absent: true; reason?: string }
  | { unknown: Error }

/**
 * Sort a failed read into `absent` (a revert answered) or `unknown` (nothing
 * answered). Pure: it only walks viem's cause chain.
 *
 * A revert with decoded data carries its error name as `reason`, so a caller
 * probing an id that DOES exist post-upgrade can still tell `UnknownElection`
 * from "no such selector" when it matters.
 */
export function classifyReadError(error: unknown): { absent: true; reason?: string } | { unknown: Error } {
  if (error instanceof BaseError) {
    const reverted = error.walk((cause) => cause instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null
    // only a DECODED name is a reason; the node's generic "execution
    // reverted" text says nothing a caller can branch on
    if (reverted) return { absent: true, reason: reverted.data?.errorName }
    // No code at the address, or a call that returned nothing where a value
    // was expected: also "not here", never a transport fault.
    if (error.walk((cause) => cause instanceof ContractFunctionZeroDataError)) return { absent: true }
  }
  return { unknown: error instanceof Error ? error : new Error(String(error)) }
}

export async function tryRead<T>(params: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }): Promise<OptionalRead<T>> {
  try {
    return { value: (await publicClient.readContract(params as never)) as T }
  } catch (error) {
    return classifyReadError(error)
  }
}

export function isPresent<T>(read: OptionalRead<T>): read is { value: T } {
  return 'value' in read
}

/** The human-facing verdict for a value that could not be shown. */
export function describeMissing(read: OptionalRead<unknown>, what: string): string {
  if ('absent' in read) return `${what} is not readable on this deployment.`
  if ('unknown' in read) return `${what} could not be read — the node did not answer.`
  return ''
}
