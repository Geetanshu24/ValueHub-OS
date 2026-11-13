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

describe('parseDeed', () => {
  const deed = `SALE DEED
This Sale Deed is made at Delhi between Sh. Mahesh Prasad Gupta S/o Late Sh. Ram Gupta R/o A-1, Delhi, hereinafter called the VENDOR
AND Sh. Ramesh Kumar Gupta S/o Late Sh. Mahesh Prasad Gupta, R/o 12 Rohini, Delhi, hereinafter called the VENDEE.
The vendor sells the residential house bearing No. 47, Gali No. 3, Sector 15, Rohini, Delhi - 110085, measuring 200 Sq. Yards. Khasra No. 547/2, District North West Delhi.`;
  it('takes the buyer, father, area and address from the deed', async () => {
    const { parseDeed } = await import('./intake-parse.js');
    const s = parseDeed(deed);
    expect(s.borrowerName?.value).toBe('Sh. Ramesh Kumar Gupta');
    expect(s.fatherName?.value).toBe('Late Sh. Mahesh Prasad Gupta');
    expect(s.area?.value).toEqual({ value: 200, unit: 'Sq.Yd' });
    expect(s.propertyClass?.value).toBe('HOUSE');
    expect(s.address?.value).toContain('Sector 15');
    expect(s.khasra?.value).toBe('547/2');
    expect(s.locality?.value).toBe('Sector 15');
    expect(s.district?.value).toBe('North West Delhi');
  });
  it('suggests nothing from unrelated text', async () => {
    const { parseDeed } = await import('./intake-parse.js');
    expect(parseDeed('hello world')).toEqual({});
  });
});
