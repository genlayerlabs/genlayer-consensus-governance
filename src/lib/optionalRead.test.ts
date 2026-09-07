import { describe, expect, it } from 'vitest'
import { ContractFunctionExecutionError, ContractFunctionRevertedError, ContractFunctionZeroDataError, HttpRequestError, encodeErrorResult, type Abi } from 'viem'
import { classifyReadError, describeMissing } from './optionalRead'

const abi = [
  { type: 'function', name: 'elections', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
  { type: 'error', name: 'UnknownElection', inputs: [{ name: 'electionId', type: 'uint256' }] },
] as const satisfies Abi

const wrap = (cause: Error) => new ContractFunctionExecutionError(cause as never, { abi, functionName: 'elections', args: [1n] })

describe('classifyReadError', () => {
  it('reads a revert with empty data as absent: a missing selector answers the question', () => {
    // exactly the shape deployment_gov3 returns for a CON-864 view today
    const error = wrap(new ContractFunctionRevertedError({ abi, functionName: 'elections' }))
    expect(classifyReadError(error)).toEqual({ absent: true, reason: undefined })
  })

  it('carries a decoded error name so a semantic revert can be told apart', () => {
    const data = encodeErrorResult({ abi, errorName: 'UnknownElection', args: [7n] })
    const error = wrap(new ContractFunctionRevertedError({ abi, functionName: 'elections', data }))
    expect(classifyReadError(error)).toEqual({ absent: true, reason: 'UnknownElection' })
  })

  it('reads zero return data as absent: nothing is deployed there', () => {
    const error = wrap(new ContractFunctionZeroDataError({ functionName: 'elections' }))
    expect(classifyReadError(error)).toEqual({ absent: true })
  })

  it('never reads a transport failure as absence', () => {
    const http = classifyReadError(new HttpRequestError({ url: 'https://rpc.invalid', details: 'fetch failed' }))
    expect('unknown' in http).toBe(true)
    const plain = classifyReadError(new Error('socket hang up'))
    expect(plain).toEqual({ unknown: expect.any(Error) })
    const thrown = classifyReadError('a string')
    expect('unknown' in thrown && thrown.unknown.message).toBe('a string')
  })
})

describe('describeMissing', () => {
  it('names the deployment for absence and the node for the unknown case, never conflating them', () => {
    expect(describeMissing({ absent: true }, 'The nomination cost')).toMatch(/not readable on this deployment/)
    expect(describeMissing({ unknown: new Error('x') }, 'The nomination cost')).toMatch(/could not be read/)
    expect(describeMissing({ value: 1 }, 'x')).toBe('')
  })
})
