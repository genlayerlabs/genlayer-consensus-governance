import { decodeAbiParameters, encodeFunctionData, type Abi, type AbiParameter, type Address, type Hex } from 'viem'
import GovernanceVotingABI from '@/abi/GovernanceVoting.json'
import { publicClient } from '@/config/clients'
import type { ProposalCore } from './types'

/**
 * `getProposal` is the one read whose SHAPE differs between deployments.
 *
 * CON-865 removed `ProposalCore.contractsHash`: a sealed deployment pins no
 * ContractSet, so the field had nothing to hold. A pre-CON-865 deployment
 * (gov3 and earlier) still returns it, one word after `payloadHash`.
 *
 * Both tuples are entirely static, so the return data is a flat run of words
 * and its length says which deployment answered — ten words for the sealed
 * shape, eleven for the ContractSet-era one. Decoding the wrong one does not
 * fail cleanly: every field from `payloadHash` on slides by a word, and the
 * first sign of it is `retryAllowed` reading a byte of the description hash
 * ("Bytes value \"120\" is not a valid boolean").
 *
 * The extra hash is read and dropped. Nothing in the UI pins a set.
 */
const TAIL: AbiParameter[] = [
  { name: 'classTimelock', type: 'uint64' },
  { name: 'retryAllowed', type: 'bool' },
  { name: 'descriptionHash', type: 'bytes32' },
]

const HEAD: AbiParameter[] = [
  { name: 'id', type: 'uint256' },
  { name: 'proposer', type: 'address' },
  { name: 'classId', type: 'uint8' },
  { name: 'creationTime', type: 'uint48' },
  { name: 'fStart', type: 'uint48' },
  { name: 'voteEnd', type: 'uint48' },
  { name: 'payloadHash', type: 'bytes32' },
]

/** CON-865 and later: no `contractsHash`. */
export const SEALED_CORE: AbiParameter[] = [...HEAD, ...TAIL]
/** gov3 and earlier: `contractsHash` between the payload hash and the timelock. */
export const CONTRACT_SET_CORE: AbiParameter[] = [...HEAD, { name: 'contractsHash', type: 'bytes32' }, ...TAIL]

export interface DecodedCore {
  core: ProposalCore
  /** true when the deployment still carries a per-proposal ContractSet pin */
  contractSetEra: boolean
}

/** Pure: pick the shape by word count, decode, and drop the retired field. */
export function decodeProposalCore(data: Hex): DecodedCore {
  const words = (data.length - 2) / 64
  const contractSetEra = words === CONTRACT_SET_CORE.length
  if (!contractSetEra && words !== SEALED_CORE.length) {
    throw new Error(
      `getProposal returned ${words} words; expected ${SEALED_CORE.length} (sealed) or ${CONTRACT_SET_CORE.length} (ContractSet-era).`,
    )
  }
  const values = decodeAbiParameters(contractSetEra ? CONTRACT_SET_CORE : SEALED_CORE, data)
  const at = (name: string) => values[(contractSetEra ? CONTRACT_SET_CORE : SEALED_CORE).findIndex((p) => p.name === name)]
  return {
    contractSetEra,
    core: {
      id: at('id') as bigint,
      proposer: at('proposer') as Address,
      classId: Number(at('classId')),
      creationTime: Number(at('creationTime')),
      fStart: Number(at('fStart')),
      voteEnd: Number(at('voteEnd')),
      payloadHash: at('payloadHash') as Hex,
      classTimelock: at('classTimelock') as bigint,
      retryAllowed: at('retryAllowed') as boolean,
      descriptionHash: at('descriptionHash') as Hex,
    },
  }
}

/** `getProposal` through a raw call, so the answer decides its own shape. */
export async function readProposalCore(voting: Address, id: bigint): Promise<DecodedCore> {
  const { data } = await publicClient.call({
    to: voting,
    data: encodeFunctionData({ abi: GovernanceVotingABI as Abi, functionName: 'getProposal', args: [id] }),
  })
  if (!data) throw new Error(`getProposal(${id}) returned no data.`)
  return decodeProposalCore(data)
}
