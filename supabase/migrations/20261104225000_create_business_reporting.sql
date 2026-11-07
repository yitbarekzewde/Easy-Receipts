create table if not exists public.business_accounts (
    uid text primary key,
    email text,
    display_name text,
    disabled boolean not null default false,
    created_at timestamptz,
    last_sign_in_at timestamptz,
    synced_at timestamptz not null default now()
);

create table if not exists public.business_customers (
    owner_uid text not null references public.business_accounts(uid) on delete cascade,
    customer_key text not null,
    name text not null default '',
    phone text not null default '',
    email text not null default '',
    due numeric not null default 0,
    deposit numeric not null default 0,
    primary key (owner_uid, customer_key)
);

create table if not exists public.business_receipts (
    owner_uid text not null references public.business_accounts(uid) on delete cascade,
    receipt_key text not null,
    receipt_ref text,
    created_at timestamptz,
    timestamp_text text,
    customer text,
    store text,
    total numeric not null default 0,
    paid numeric not null default 0,
    items jsonb not null default '[]'::jsonb,
    primary key (owner_uid, receipt_key)
);

create index if not exists business_customers_owner_name_idx
    on public.business_customers (owner_uid, name);

create index if not exists business_receipts_owner_created_idx
    on public.business_receipts (owner_uid, created_at desc);

alter table public.business_accounts enable row level security;
alter table public.business_customers enable row level security;
alter table public.business_receipts enable row level security;

revoke all on public.business_accounts, public.business_customers, public.business_receipts
    from public, anon, authenticated;
grant all on public.business_accounts, public.business_customers, public.business_receipts
    to service_role;

create or replace function public.replace_business_account_data(
    p_account jsonb,
    p_customers jsonb,
    p_receipts jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    account_uid text := p_account->>'uid';
begin
    if auth.role() is distinct from 'service_role' then
        raise exception 'service role required';
    end if;
    if account_uid is null or account_uid = '' then
        raise exception 'account uid is required';
    end if;

    insert into public.business_accounts (
        uid, email, display_name, disabled, created_at, last_sign_in_at, synced_at
    ) values (
        account_uid,
        nullif(p_account->>'email', ''),
        nullif(p_account->>'display_name', ''),
        coalesce((p_account->>'disabled')::boolean, false),
        nullif(p_account->>'created_at', '')::timestamptz,
        nullif(p_account->>'last_sign_in_at', '')::timestamptz,
        coalesce(nullif(p_account->>'synced_at', '')::timestamptz, now())
    )
    on conflict (uid) do update set
        email = excluded.email,
        display_name = excluded.display_name,
        disabled = excluded.disabled,
        created_at = excluded.created_at,
        last_sign_in_at = excluded.last_sign_in_at,
        synced_at = excluded.synced_at;

    delete from public.business_customers where owner_uid = account_uid;
    insert into public.business_customers (
        owner_uid, customer_key, name, phone, email, due, deposit
    )
    select
        account_uid, customer_key, coalesce(name, ''), coalesce(phone, ''),
        coalesce(email, ''), coalesce(due, 0), coalesce(deposit, 0)
    from jsonb_to_recordset(coalesce(p_customers, '[]'::jsonb)) as customers(
        customer_key text, name text, phone text, email text, due numeric, deposit numeric
    );

    delete from public.business_receipts where owner_uid = account_uid;
    insert into public.business_receipts (
        owner_uid, receipt_key, receipt_ref, created_at, timestamp_text,
        customer, store, total, paid, items
    )
    select
        account_uid, receipt_key, receipt_ref, created_at, timestamp_text,
        customer, store, coalesce(total, 0), coalesce(paid, 0), coalesce(items, '[]'::jsonb)
    from jsonb_to_recordset(coalesce(p_receipts, '[]'::jsonb)) as receipts(
        receipt_key text, receipt_ref text, created_at timestamptz, timestamp_text text,
        customer text, store text, total numeric, paid numeric, items jsonb
    );
end;
$$;

revoke all on function public.replace_business_account_data(jsonb, jsonb, jsonb)
    from public, anon, authenticated;
grant execute on function public.replace_business_account_data(jsonb, jsonb, jsonb)
    to service_role;
