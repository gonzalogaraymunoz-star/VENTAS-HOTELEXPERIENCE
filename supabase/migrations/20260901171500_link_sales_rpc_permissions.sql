-- Restrict LINK sales SECURITY DEFINER RPCs and trigger helpers.
-- Client-facing RPCs are authenticated-only and still validate profiles.role internally.
revoke all on function public.create_link_sale(jsonb) from public, anon;
grant execute on function public.create_link_sale(jsonb) to authenticated;

revoke all on function public.confirm_link_sale(uuid) from public, anon;
grant execute on function public.confirm_link_sale(uuid) to authenticated;

-- Trigger helpers do not need to be callable as REST RPCs.
revoke all on function public.assign_link_payment_code() from public, anon, authenticated;
revoke all on function public.assign_link_commission_code() from public, anon, authenticated;
