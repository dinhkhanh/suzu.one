// Settling advances (REQ-01). Pure: no I/O.
//
// A business trip's advances are paid before the trip; the payment request filed under the trip
// once it is over is the settlement. Finance then pays what was spent **less what was advanced** —
// or, when the advance was more than was spent, takes the rest back. Only money that actually left
// (a paid advance) is netted, and only against payments under the same parent, in filing order:
// each takes what it can, and the last one still open takes whatever is left, so an advance that
// was larger than everything spent ends as a negative figure — the requester owes it back.
//
// Amounts are whole đồng.

/** An approved request of the "payment" kind under the parent, in filing order. */
export type SettlingPayment = { id: string; amount: number; /** What finance paid, once it has (net of the advance netted then). */ paidAmount: number | null };

export type Settlement = {
  /** How much of the paid advances this payment takes up. */
  nettedAdvance: number;
  /** What changes hands: positive = finance pays it, negative = the requester returns it. */
  toPay: number;
};

/**
 * Nets the paid advances under one parent against its payments. A payment already paid keeps what
 * it netted then (its amount less what was paid), and that comes off the advance first.
 */
export function settleAdvances(paidAdvances: number, payments: readonly SettlingPayment[]): Map<string, Settlement> {
  const result = new Map<string, Settlement>();
  let left = paidAdvances;
  for (const payment of payments) {
    if (payment.paidAmount === null) continue;
    const netted = payment.amount - payment.paidAmount;
    left -= netted;
    result.set(payment.id, { nettedAdvance: netted, toPay: payment.paidAmount });
  }
  const open = payments.filter((payment) => payment.paidAmount === null);
  open.forEach((payment, index) => {
    const last = index === open.length - 1;
    const netted = last ? Math.max(0, left) : Math.max(0, Math.min(left, payment.amount));
    left -= netted;
    result.set(payment.id, { nettedAdvance: netted, toPay: payment.amount - netted });
  });
  return result;
}
