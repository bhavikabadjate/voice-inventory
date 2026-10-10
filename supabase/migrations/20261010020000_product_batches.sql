-- Expiry batches for the web prototype: each delivery of a product keeps its
-- own expiry date and quantity, e.g. [{"qty": 5, "exp": "2026-10-14"}, {"qty": 15, "exp": ""}].
-- `expiry` still holds the earliest date, so the phone app keeps working unchanged.
-- Optional: without this column the web page keeps batches on each phone only.
alter table public.products add column if not exists batches jsonb;
