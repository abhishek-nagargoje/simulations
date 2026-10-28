-- Zoho CRM and Amazon S/4HANA join the application catalogue.
-- The zoho-crm row already exists (disabled placeholder without content); it is
-- re-enabled now that its module is installed. Idempotent; no data is deleted.
insert into app.simulations (slug, name, description, category, enabled, display_order)
values
  ('zoho-crm', 'Zoho CRM',
   'Leads, contacts, accounts, deals and pipelines, activities, quotes, orders, invoices, cases, reports and dashboards.',
   'CRM', true, 3),
  ('amazon-s4hana', 'Amazon S/4HANA',
   'Procure-to-pay on SAP S/4HANA: purchase requisitions and orders, goods movements, invoice verification, MRP, vendor invoice management and reporting.',
   'Supply Chain', true, 4)
on conflict (slug) do update
  set name = excluded.name, description = excluded.description, category = excluded.category,
      enabled = true, display_order = excluded.display_order, updated_at = now();
