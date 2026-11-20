-- Custom pay & deduction lines attached to an employee/month.
-- These are explicit, audited records in the database rather than browser
-- storage, so they survive reloads, are shared across devices, and respect
-- tenant isolation through RLS.

create table if not exists skyhook.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references skyhook.tenants (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  employee_code text not null,
  kind text not null check (kind in ('pay', 'deduction')),
  label text not null check (length(btrim(label)) between 1 and 120),
  amount_paise bigint not null check (amount_paise > 0),
  remarks text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payroll_adjustments_lookup_idx
  on skyhook.payroll_adjustments (tenant_id, month, employee_code);

alter table skyhook.payroll_adjustments enable row level security;
alter table skyhook.payroll_adjustments force row level security;
drop policy if exists tenant_isolation on skyhook.payroll_adjustments;
create policy tenant_isolation on skyhook.payroll_adjustments
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

grant usage on schema skyhook to skyhook_app;
grant select, insert, delete on skyhook.payroll_adjustments to skyhook_app;

-- Dedicated permission: only the owner can add or remove custom lines.
insert into skyhook.permissions (code, description)
values ('payroll:adjust', 'Add or remove custom pay and deduction lines')
on conflict (code) do nothing;

insert into skyhook.role_permissions (role_id, permission_id)
select r.id, p.id
from skyhook.roles r
cross join skyhook.permissions p
where r.name = 'owner' and p.code = 'payroll:adjust'
on conflict do nothing;
