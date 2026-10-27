-- Neutral application names: the HRMS application is shown as "HR Management".
-- The slug (hr-remedy-hrms) is an internal identifier and stays unchanged, so
-- existing access sessions, links and audit records keep working.
-- Idempotent; touches only the catalogue row's display name.
update app.simulations
   set name = 'HR Management', updated_at = now()
 where slug = 'hr-remedy-hrms'
   and name is distinct from 'HR Management';
