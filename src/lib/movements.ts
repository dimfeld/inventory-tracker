/** A readable name for each stock movement type. */
export const MOVEMENT_LABELS: Record<string, string> = {
  opening: "Opening stock",
  transfer: "Transfer",
  loss: "Loss",
  supplier_return: "Supplier return",
  count_correction: "Count correction",
  pick: "Picked for project",
  project_use: "Used by project",
  project_return: "Returned from project",
  receipt: "Order receipt",
  conversion: "Converted to pieces",
  cut: "Cut",
  scrap: "Scrapped",
  use: "Used outside a project",
};
