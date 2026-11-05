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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
