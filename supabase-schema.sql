create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  street text not null default '',
  exterior_number text not null default '',
  interior_number text not null default '',
  neighborhood text not null default '',
  postal_code text not null default '',
  city text not null default '',
  state text not null default '',
  phone text not null default '',
  privacy_policy_version text not null default '',
  privacy_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles
  add column if not exists privacy_policy_version text not null default '',
  add column if not exists privacy_consent_at timestamptz;

alter table public.user_profiles enable row level security;

drop policy if exists "Users can view their own profile" on public.user_profiles;
create policy "Users can view their own profile"
  on public.user_profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can create their own profile" on public.user_profiles;
create policy "Users can create their own profile"
  on public.user_profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.user_profiles;
create policy "Users can update their own profile"
  on public.user_profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

grant select, insert, update on public.user_profiles to authenticated;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_checkout_session_id text not null unique,
  amount integer not null check (amount >= 0),
  currency text not null default 'mxn',
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'cancelled')),
  items jsonb not null default '[]'::jsonb,
  shipping_address jsonb,
  customer_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orders enable row level security;

drop policy if exists "Users can view their own orders" on public.orders;
create policy "Users can view their own orders"
  on public.orders for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.orders to authenticated;
