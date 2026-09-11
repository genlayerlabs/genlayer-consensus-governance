import { describe, expect, it } from 'vitest'
import { decodeAbiParameters, encodeAbiParameters, type Address, type Hex } from 'viem'
import { CONTRACT_SET_CORE, decodeProposalCore, SEALED_CORE } from './proposalCore'

const PROPOSER = '0x01cAaA984437440d585211F5b9b4D9fFa7E0f6f4' as Address
const PAYLOAD = `0x${'11'.repeat(32)}` as Hex
const SET_HASH = `0x${'22'.repeat(32)}` as Hex
const DESCRIPTION = `0x${'33'.repeat(32)}` as Hex

const HEAD = [9n, PROPOSER, 4, 1789152558, 0, 1789153758, PAYLOAD]
const TAIL = [1800n, true, DESCRIPTION]

const sealed = () => encodeAbiParameters(SEALED_CORE, [...HEAD, ...TAIL])
const contractSetEra = () => encodeAbiParameters(CONTRACT_SET_CORE, [...HEAD, SET_HASH, ...TAIL])

/**
 * The shapes differ by one word: CON-865 dropped `ProposalCore.contractsHash`,
 * which gov3 still returns. Both tuples are static, so the word count decides.
 */
describe('decoding a proposal core across deployment eras', () => {
  it('reads the sealed shape', () => {
    const { core, contractSetEra: era } = decodeProposalCore(sealed())
    expect(era).toBe(false)
    expect(core).toEqual({
      id: 9n, proposer: PROPOSER, classId: 4, creationTime: 1789152558, fStart: 0, voteEnd: 1789153758,
      payloadHash: PAYLOAD, classTimelock: 1800n, retryAllowed: true, descriptionHash: DESCRIPTION,
    })
  })

  it('reads the ContractSet-era shape and drops the retired pin', () => {
    const { core, contractSetEra: era } = decodeProposalCore(contractSetEra())
    expect(era).toBe(true)
    expect(core.classTimelock).toBe(1800n)
    expect(core.retryAllowed).toBe(true)
    expect(core.descriptionHash).toBe(DESCRIPTION)
    expect(Object.values(core)).not.toContain(SET_HASH)
  })

  it('decodes both eras to the same core, the extra word aside', () => {
    expect(decodeProposalCore(sealed()).core).toEqual(decodeProposalCore(contractSetEra()).core)
  })

  it('shows why the length check exists: the old data read as the sealed shape throws', () => {
    // payloadHash onward slides by a word, so retryAllowed lands on the
    // class timelock and viem refuses any byte that is not 0 or 1 — the
    // "Bytes value \"120\" is not a valid boolean" this fix removes.
    expect(() => decodeAbiParameters(SEALED_CORE, contractSetEra())).toThrow()
  })

  it('refuses a length that is neither shape rather than guessing', () => {
    expect(() => decodeProposalCore(`0x${'00'.repeat(32 * 9)}` as Hex)).toThrow(/returned 9 words/)
    expect(() => decodeProposalCore('0x' as Hex)).toThrow(/returned 0 words/)
  })
})
