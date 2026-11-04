const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function below1000(n: number): string {
  const parts: string[] = []
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} hundred`); n %= 100 }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')) } else if (n > 0) parts.push(ONES[n])
  return parts.join(' ')
}

// "Rupees one crore twenty-three lakh ... only", in the Indian grouping used in valuation reports.
export function rupeesInWords(amount: number): string {
  const value = Math.round(Math.abs(amount) * 100)
  let rupees = Math.floor(value / 100)
  const paise = value % 100
  if (rupees === 0 && paise === 0) return 'Rupees zero only'
  const units: [number, string][] = [[10000000, 'crore'], [100000, 'lakh'], [1000, 'thousand']]
  const parts: string[] = []
  for (const [size, name] of units) {
    if (rupees >= size) { parts.push(`${below1000(Math.floor(rupees / size))} ${name}`); rupees %= size }
  }
  if (rupees > 0) parts.push(below1000(rupees))
  const text = parts.join(' ') || 'zero'
  return `Rupees ${text}${paise ? ` and ${below1000(paise)} paise` : ''} only`
}
