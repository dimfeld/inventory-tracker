/** Accepted receipt stock assigned to one incoming commitment, in the part's base unit. */
export interface CommitmentAssignment {
  commitmentId: number;
  quantity: number;
}

/**
 * The default assignment of an accepted quantity to an order line's commitments: fill them in
 * sequence order until the accepted stock runs out. `commitments` must be in sequence order.
 */
export function assignInSequence(
  commitments: { id: number; quantity: number }[],
  accepted: number
): CommitmentAssignment[] {
  let left = accepted;
  return commitments.map((commitment) => {
    const quantity = Math.min(commitment.quantity, left);
    left -= quantity;
    return { commitmentId: commitment.id, quantity };
  });
}
