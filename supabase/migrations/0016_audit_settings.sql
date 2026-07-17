-- Phase 9: deactivatable users. The audit chain (0007) already exists.
alter table profiles add column active boolean not null default true;
