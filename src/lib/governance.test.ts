import { parseEther } from 'viem'
import { describe, expect, it } from 'vitest'
import { descriptionHash, encodeOperation, formatGen, preserveAlignedBlocks, payloadHash, titleFromDescription, voteChecks, ZERO_HASH } from './governance'

describe('governance helpers', () => {
  it('extracts a safe title with a proposal fallback', () => {
    expect(titleFromDescription('\n# **Upgrade the executor**\nBody', 7n)).toBe('Upgrade the executor')
    expect(titleFromDescription('   ', 7n)).toBe('Proposal #7')
  })

  it('uses exact GES cross multiplication for passage checks', () => {
    const rules = { quorumBps: 800, forFloorBps: 500, thresholdNum: 1, thresholdDen: 2, requiresRiskReview: false, vetoWindow: 0, extendedVetoWindow: 0, reviewWindow: 0, executionWindow: 0, preparation: 0, votingPeriod: 0, lateQuorumWindow: 0 }
    expect(voteChecks({ for: 51n, against: 49n, abstain: 0n }, rules, 1_001n)).toMatchObject({ quorumRequired: 81n, floorRequired: 51n, quorumMet: true, floorMet: true, thresholdMet: true })
    expect(voteChecks({ for: 50n, against: 50n, abstain: 0n }, rules, 1_001n).thresholdMet).toBe(false)
  })

  it('encodes operations and commitments deterministically', () => {
    const operation = encodeOperation({ target: '0x0000000000000000000000000000000000000001', mode: 'abi', signature: 'setValue(uint256)', argsJson: '[42]', rawSelector: '0x', rawArgs: '0x', value: '0' })
    expect(operation.selector).toHaveLength(10)
    expect(operation.args).toHaveLength(66)
    expect(payloadHash([operation])).toMatch(/^0x[0-9a-f]{64}$/)
    expect(payloadHash([])).toBe(ZERO_HASH)
    expect(descriptionHash('# Test')).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('formats large GEN values without unsafe Number conversion', () => {
    expect(formatGen(parseEther('462000000.125'), 3)).toBe('462,000,000.125')
  })

  it('fences hand-aligned box-drawing tables so markdown cannot reflow them', () => {
    const table = ['┌──────┬───────┐', '│ Key  │ Value │', '└──────┴───────┘'].join('\n')
    const out = preserveAlignedBlocks(`# Title\n\ntext\n\n${table}\n\ntail`)
    expect(out).toContain('```text\n┌──────┬───────┐')
    expect(out).toContain('└──────┴───────┘\n```')
    // prose is untouched
    expect(out).toContain('# Title')
    expect(out).toContain('tail')
  })

  it('leaves an existing code fence alone', () => {
    const input = '```\n┌──┐\n└──┘\n```'
    expect(preserveAlignedBlocks(input)).toBe(input)
  })

  it('keeps sub-unit amounts legible instead of rendering a bare 0', () => {
    // The proposal bond is 0.1% of GES, so a small GES puts it below the
    // default two decimals; truncating it to "0" read as "no bond required".
    expect(formatGen(parseEther('0.005'))).toBe('0.005')
    expect(formatGen(parseEther('0.05'))).toBe('0.05')
    expect(formatGen(1n)).toBe('0.000000000000000001')
    // a genuine zero stays bare, and whole amounts keep the 2-digit default
    expect(formatGen(0n)).toBe('0')
    expect(formatGen(parseEther('1501'))).toBe('1,501')
    expect(formatGen(parseEther('1234.5678'))).toBe('1,234.56')
  })
})
