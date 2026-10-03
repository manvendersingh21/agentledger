-- Demo fixtures applied after seed.sql. Merchants are fictional demo businesses, so their trust scores are
-- labelled 'fixture' (never presented as ScamAdvisor results).
update public.merchants m set domain = f.domain, trust_score = f.score, trust_score_source = 'fixture', trust_scored_at = now()
from (values
  ('acme-api', 'acme-api.dev', 98),
  ('vectorbase', 'vectorbase.io', 97),
  ('devhost', 'devhost.app', 96),
  ('cheapcompute', 'cheapcompute.net', 91),
  ('evil-cloud', 'evil-cloud-deals.xyz', 12)
) as f(slug, domain, score)
where m.slug = f.slug;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'merchants' and column_name = 'verified') then
    execute $q$update public.merchants set verified = (slug in ('acme-api', 'vectorbase')), verified_at = case when slug in ('acme-api', 'vectorbase') then now() end$q$;
  end if;
end $$;
