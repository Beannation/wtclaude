-- 006_verify_daily_poolkey.sql
-- Belt-and-suspenders for QA-BUG-05 (migration 005). Reports the live UNIQUE
-- indexes on daily_summaries + turns via RAISE NOTICE (visible in `db push`
-- output) and, defensively, drops ANY remaining unique on exactly (user_id, date)
-- — whether a table constraint or a bare index, under any name — so the only
-- daily uniqueness left is the pool-split (user_id, date, usage_pool) from 005.
-- Idempotent + read-mostly: safe to re-run; a no-op once the state is correct.

do $$
declare r record;
begin
  for r in
    select i.relname as idx,
           array_agg(a.attname::text order by k.ord) as cols,
           con.conname
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class t on t.oid = ix.indrelid
    left join pg_constraint con on con.conindid = ix.indexrelid
    join lateral unnest(ix.indkey) with ordinality k(attnum, ord) on true
    join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
    where t.relname = 'daily_summaries' and ix.indisunique
    group by i.relname, con.conname
  loop
    raise notice 'daily_summaries UNIQUE: % cols=% constraint=%', r.idx, r.cols, coalesce(r.conname, '(plain index)');
    if r.cols = array['user_id','date'] then
      if r.conname is not null then
        execute format('alter table daily_summaries drop constraint %I', r.conname);
        raise notice '  -> dropped leftover (user_id,date) constraint %', r.conname;
      else
        execute format('drop index if exists public.%I', r.idx);
        raise notice '  -> dropped leftover (user_id,date) index %', r.idx;
      end if;
    end if;
  end loop;

  for r in
    select i.relname as idx, array_agg(a.attname::text order by k.ord) as cols
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class t on t.oid = ix.indrelid
    join lateral unnest(ix.indkey) with ordinality k(attnum, ord) on true
    join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
    where t.relname = 'turns' and ix.indisunique
    group by i.relname
  loop
    raise notice 'turns UNIQUE: % cols=%', r.idx, r.cols;
  end loop;
end $$;
