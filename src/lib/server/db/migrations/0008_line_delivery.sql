-- Delivery state per order line. An order often arrives in several parcels at different times,
-- so each line records its own delivery. The order's delivery status is derived from its lines.

-- `delivery_state` is the parcel state of the line, kept separate from stock receipt. A line
-- marked delivered waits for review; a receipt that leaves nothing outstanding makes it
-- 'reviewed', and a receipt that leaves some outstanding returns it to 'not_delivered'.
-- `delivered_on` is the date of the line's latest delivery and stays when the rest of the line
-- is still expected.
ALTER TABLE order_lines ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'not_delivered'
  CHECK (delivery_state IN ('not_delivered', 'awaiting_review', 'reviewed'));
ALTER TABLE order_lines ADD COLUMN delivered_on TEXT;

-- A delivered order that waits for review: its outstanding lines wait for review of that parcel.
UPDATE order_lines
SET delivery_state = 'awaiting_review',
  delivered_on = (SELECT o.delivered_on FROM orders o WHERE o.id = order_lines.order_id)
WHERE order_id IN (SELECT id FROM orders WHERE delivery_state = 'awaiting_review')
  AND quantity - received_quantity - damaged_quantity - cancelled_quantity > 0;

-- A reviewed order: all of its lines are reviewed.
UPDATE order_lines
SET delivery_state = 'reviewed',
  delivered_on = (SELECT o.delivered_on FROM orders o WHERE o.id = order_lines.order_id)
WHERE order_id IN (SELECT id FROM orders WHERE delivery_state = 'reviewed');

-- A line that has nothing outstanding after receipts is reviewed, whatever the order's state.
-- The date is the order's delivery date, or else the line's latest receipt.
UPDATE order_lines
SET delivery_state = 'reviewed',
  delivered_on = coalesce(
    (SELECT o.delivered_on FROM orders o
     WHERE o.id = order_lines.order_id AND o.delivery_state <> 'not_delivered'),
    (SELECT max(r.received_on) FROM receipt_lines rl JOIN receipts r ON r.id = rl.receipt_id
     WHERE rl.order_line_id = order_lines.id))
WHERE received_quantity + damaged_quantity > 0
  AND quantity - received_quantity - damaged_quantity - cancelled_quantity = 0;

-- A partly received line that is still expected keeps the date of its latest receipt.
UPDATE order_lines
SET delivered_on = (SELECT max(r.received_on) FROM receipt_lines rl
  JOIN receipts r ON r.id = rl.receipt_id WHERE rl.order_line_id = order_lines.id)
WHERE delivery_state = 'not_delivered' AND received_quantity + damaged_quantity > 0;

-- The order-level columns are replaced by the line columns. Their CHECK constraint belongs to
-- the column itself and no index, view, trigger, or foreign key uses them, so SQLite can drop
-- them without a table rebuild.
ALTER TABLE orders DROP COLUMN delivery_state;
ALTER TABLE orders DROP COLUMN delivered_on;
