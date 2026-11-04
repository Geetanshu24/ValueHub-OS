import { describe, expect, it } from 'vitest';
import { parseInstruction } from './intake-parse.js';

const banks = [
  { id: 'b1', name: 'State Bank of India' },
  { id: 'b2', name: 'Punjab National Bank' },
];

const letter = `State Bank of India
Valuation Instruction
Date: 24-10-2026
Name of Borrower: ABC Pvt. Ltd.
Purpose: Loan Against Property
Property Address: Plot No. 123, HUDA Sector 12, Panipat, Haryana
Type: Residential House
`;

describe('parseInstruction', () => {
  it('reads the details of a typical instruction letter', () => {
    const s = parseInstruction(letter, banks);
    expect(s.bankId?.value).toBe('b1');
    expect(s.purpose?.value).toBe('Loan Against Property (LAP)');
    expect(s.address?.value).toBe('Plot No. 123, HUDA Sector 12, Panipat, Haryana');
    expect(s.propertyClass?.value).toBe('HOUSE');
    expect(s.instructionDate?.value).toBe('2026-10-24');
    expect(s.borrowerName?.value).toBe('ABC Pvt. Ltd');
  });

  it('suggests nothing it cannot find', () => {
    expect(parseInstruction('hello world', banks)).toEqual({});
  });

  it('rejects impossible dates', () => {
    expect(parseInstruction('Date: 31-02-2026', banks).instructionDate).toBeUndefined();
  });

  it('judges the property type from the address, not the letterhead', () => {
    const s = parseInstruction('Commercial Banking Division\nProperty Address: Flat 402, XYZ Residency, Sector 12', banks);
    expect(s.propertyClass?.value).toBe('FLAT');
  });
});
