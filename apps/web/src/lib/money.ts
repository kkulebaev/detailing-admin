// Rubles for the salaries tables. Both formatters live here so a row can never
// mix minus glyphs: `formatAmount` and `formatSigned` appear side by side in the
// same table row, and a hyphen next to a U+2212 reads as two different numbers.
//
// The minus is U+2212 MINUS SIGN, not a hyphen: next to tabular digits a hyphen
// reads as a dash and is easy to miss.
export function formatAmount(n: number): string {
  const grouped = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return n < 0 ? `−${grouped}` : grouped
}

// Signed money for the one-off payment column, where the direction of a payout
// is the whole point: an explicit "+" makes an accrual unambiguous. Extracted
// from the SFCs so the sign handling is unit-testable — it is the one place
// where a wrong character turns a deduction into a bonus on screen.
export function formatSigned(n: number): string {
  return n > 0 ? `+${formatAmount(n)}` : formatAmount(n)
}
