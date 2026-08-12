create table if not exists public.player_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  game_state jsonb not null default '{}'::jsonb,
  level integer not null default 1,
  pollution numeric not null default 100,
  tree_height numeric not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.player_progress enable row level security;

drop policy if exists "Players can read their own progress" on public.player_progress;
create policy "Players can read their own progress"
on public.player_progress for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Players can create their own progress" on public.player_progress;
create policy "Players can create their own progress"
on public.player_progress for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Players can update their own progress" on public.player_progress;
create policy "Players can update their own progress"
on public.player_progress for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

grant select, insert, update on table public.player_progress to authenticated;

alter table public.player_progress add column if not exists display_name text;
alter table public.player_progress add column if not exists last_name_change_at timestamptz;
alter table public.player_progress add column if not exists weekly_charges integer not null default 0;
alter table public.player_progress add column if not exists monthly_charges integer not null default 0;
alter table public.player_progress add column if not exists week_key text not null default '';
alter table public.player_progress add column if not exists month_key text not null default '';

create unique index if not exists player_progress_display_name_unique
on public.player_progress (lower(display_name))
where display_name is not null;

create or replace function public.change_player_id(new_id text)
returns table(display_name text, last_name_change_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text := btrim(new_id);
  previous_change timestamptz;
begin
  if auth.uid() is null then
    raise exception '请先登录';
  end if;
  if char_length(cleaned) < 2 or char_length(cleaned) > 16
     or cleaned !~ '^[[:alnum:]_一-龥-]+$' then
    raise exception 'ID 需为 2–16 位中文、字母、数字、下划线或短横线';
  end if;
  select p.last_name_change_at into previous_change
  from public.player_progress p where p.user_id = auth.uid();
  if not found then
    raise exception '请先进入游戏建立云存档';
  end if;
  if previous_change is not null and previous_change > now() - interval '1 month' then
    raise exception '玩家 ID 每月只能修改一次';
  end if;
  update public.player_progress p
  set display_name = cleaned, last_name_change_at = now(), updated_at = now()
  where p.user_id = auth.uid();
  return query
  select p.display_name, p.last_name_change_at
  from public.player_progress p where p.user_id = auth.uid();
exception
  when unique_violation then
    raise exception '该玩家 ID 已被使用';
end;
$$;

create or replace function public.get_leaderboard(board_name text)
returns table(player_id text, metric numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '请先登录';
  end if;
  if board_name = 'height' and coalesce((select p.pollution from public.player_progress p where p.user_id = auth.uid()),100) > 0 then
    return;
  end if;
  if board_name = 'purification' then
    return query select coalesce(p.display_name,'未命名玩家'),p.pollution::numeric from public.player_progress p order by p.pollution asc,p.updated_at asc limit 100;
  elsif board_name = 'height' then
    return query select coalesce(p.display_name,'未命名玩家'),p.tree_height::numeric from public.player_progress p where p.pollution <= 0 order by p.tree_height desc,p.updated_at asc limit 100;
  elsif board_name = 'weekly' then
    return query select coalesce(p.display_name,'未命名玩家'),p.weekly_charges::numeric from public.player_progress p where p.week_key = to_char(current_date,'IYYY-IW') order by p.weekly_charges desc,p.updated_at asc limit 100;
  elsif board_name = 'monthly' then
    return query select coalesce(p.display_name,'未命名玩家'),p.monthly_charges::numeric from public.player_progress p where p.month_key = to_char(current_date,'YYYY-MM') order by p.monthly_charges desc,p.updated_at asc limit 100;
  else
    raise exception '未知榜单';
  end if;
end;
$$;

revoke all on function public.change_player_id(text) from public;
revoke all on function public.get_leaderboard(text) from public;
grant execute on function public.change_player_id(text) to authenticated;
grant execute on function public.get_leaderboard(text) to authenticated;

-- 好友、聊天、每日成就与称号
alter table public.player_progress add column if not exists active_title text not null default '';
alter table public.player_progress add column if not exists display_titles text[] not null default '{}';
alter table public.player_progress add column if not exists friendship_crystals integer not null default 0;
alter table public.player_progress add column if not exists armor text not null default 'none';
alter table public.player_progress add column if not exists radar_owned boolean not null default false;
alter table public.player_progress add column if not exists magnifier_owned boolean not null default false;
alter table public.player_progress add column if not exists crystal_level integer not null default 0;
alter table public.player_progress add column if not exists crystal_sleep_until timestamptz;
alter table public.player_progress add column if not exists crystal_lesson_progress integer not null default 0;
alter table public.player_progress add column if not exists crystal_raid_progress integer not null default 0;

create table if not exists public.friendships (
  id bigint generated by default as identity primary key,
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
create unique index if not exists friendships_pair_unique
on public.friendships (least(requester_id,addressee_id),greatest(requester_id,addressee_id));

create table if not exists public.friend_messages (
  id bigint generated by default as identity primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists friend_messages_pair_time
on public.friend_messages (sender_id,receiver_id,created_at);

create table if not exists public.drift_bottles (
  id bigint generated by default as identity primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  status text not null default 'floating' check (status in ('floating','picked','replied')),
  picked_by uuid references auth.users(id) on delete set null,
  reply_body text,
  crystals_awarded integer not null default 0,
  created_at timestamptz not null default now(),
  picked_at timestamptz,
  replied_at timestamptz
);
create table if not exists public.friend_sparks (
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  current_days integer not null default 0,
  last_chat_date date,
  frozen boolean not null default false,
  thaw_streak integer not null default 0,
  primary key(user_a,user_b),
  check(user_a<user_b)
);

create table if not exists public.daily_lesson_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  clear_count integer not null default 0,
  primary key (user_id,activity_date)
);

create table if not exists public.user_titles (
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source text not null,
  expires_at timestamptz,
  awarded_at timestamptz not null default now(),
  primary key (user_id,title)
);
alter table public.user_titles add column if not exists expires_at timestamptz;

create table if not exists public.user_mail (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  body text not null,
  item_type text not null default 'none' check (item_type in ('none','coins','hp','spells')),
  item_amount integer not null default 0 check (item_amount>=0),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  claimed_at timestamptz
);
create index if not exists user_mail_owner_time on public.user_mail(user_id,created_at desc);

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.friendships enable row level security;
alter table public.friend_messages enable row level security;
alter table public.daily_lesson_activity enable row level security;
alter table public.user_titles enable row level security;
alter table public.user_mail enable row level security;
alter table public.app_admins enable row level security;
alter table public.drift_bottles enable row level security;
alter table public.friend_sparks enable row level security;
revoke all on table public.friendships,public.friend_messages,public.daily_lesson_activity,public.user_titles,public.user_mail,public.app_admins,public.drift_bottles,public.friend_sparks from anon,authenticated;

create or replace function public.get_leaderboard_v2(board_name text)
returns table(player_id text,metric numeric,display_titles text[])
language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if board_name='height' and coalesce((select pollution from public.player_progress where user_id=auth.uid()),100)>0 then return; end if;
  if board_name='purification' then return query select coalesce(p.display_name,'未命名玩家'),p.pollution::numeric,p.display_titles from public.player_progress p order by p.pollution,p.updated_at limit 100;
  elsif board_name='height' then return query select coalesce(p.display_name,'未命名玩家'),p.tree_height::numeric,p.display_titles from public.player_progress p where p.pollution<=0 order by p.tree_height desc,p.updated_at limit 100;
  elsif board_name='weekly' then return query select coalesce(p.display_name,'未命名玩家'),p.weekly_charges::numeric,p.display_titles from public.player_progress p where p.week_key=to_char(current_date,'IYYY-IW') order by p.weekly_charges desc,p.updated_at limit 100;
  elsif board_name='monthly' then return query select coalesce(p.display_name,'未命名玩家'),p.monthly_charges::numeric,p.display_titles from public.player_progress p where p.month_key=to_char(current_date,'YYYY-MM') order by p.monthly_charges desc,p.updated_at limit 100;
  else raise exception '未知榜单'; end if;
end;
$$;

create or replace function public.search_players_v2(search_text text)
returns table(user_id uuid,display_name text,display_titles text[])
language sql security definer set search_path=public
as $$
  select p.user_id,p.display_name,p.display_titles from public.player_progress p
  where auth.uid() is not null and p.user_id<>auth.uid() and p.display_name is not null and p.display_name ilike '%'||btrim(search_text)||'%'
  order by case when lower(p.display_name)=lower(btrim(search_text)) then 0 else 1 end,p.display_name limit 20;
$$;

create or replace function public.search_players(search_text text)
returns table(user_id uuid,display_name text,active_title text)
language sql security definer set search_path=public
as $$
  select p.user_id,p.display_name,p.active_title
  from public.player_progress p
  where auth.uid() is not null and p.user_id<>auth.uid()
    and p.display_name is not null and p.display_name ilike '%'||btrim(search_text)||'%'
  order by case when lower(p.display_name)=lower(btrim(search_text)) then 0 else 1 end,p.display_name
  limit 20;
$$;

create or replace function public.send_friend_request(target_id uuid)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  if target_id=auth.uid() then raise exception '不能添加自己'; end if;
  if not exists(select 1 from public.player_progress where user_id=target_id) then raise exception '玩家不存在'; end if;
  insert into public.friendships(requester_id,addressee_id,status)
  values(auth.uid(),target_id,'pending')
  on conflict ((least(requester_id,addressee_id)),(greatest(requester_id,addressee_id)))
  do update set requester_id=auth.uid(),addressee_id=target_id,status=case when friendships.status='accepted' then 'accepted' else 'pending' end,updated_at=now();
end;
$$;

create or replace function public.respond_friend_request(request_id bigint,accept_request boolean)
returns void language plpgsql security definer set search_path=public
as $$
begin
  update public.friendships set status=case when accept_request then 'accepted' else 'rejected' end,updated_at=now()
  where id=request_id and addressee_id=auth.uid() and status='pending';
  if not found then raise exception '好友申请不存在或已处理'; end if;
end;
$$;

create or replace function public.get_social_data()
returns jsonb language sql security definer set search_path=public
as $$
  select jsonb_build_object(
    'friends',coalesce((select jsonb_agg(jsonb_build_object('user_id',p.user_id,'display_name',coalesce(p.display_name,'未命名玩家'),'display_titles',p.display_titles) order by p.display_name)
      from public.friendships f join public.player_progress p on p.user_id=case when f.requester_id=auth.uid() then f.addressee_id else f.requester_id end
      where f.status='accepted' and auth.uid() in(f.requester_id,f.addressee_id)),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('request_id',f.id,'user_id',p.user_id,'display_name',coalesce(p.display_name,'未命名玩家'),'display_titles',p.display_titles) order by f.created_at desc)
      from public.friendships f join public.player_progress p on p.user_id=f.requester_id
      where f.addressee_id=auth.uid() and f.status='pending'),'[]'::jsonb),
    'titles',coalesce((select jsonb_agg(t.title order by t.awarded_at) from public.user_titles t where t.user_id=auth.uid() and (t.expires_at is null or t.expires_at>now())),'[]'::jsonb),
    'friendship_crystals',coalesce((select p.friendship_crystals from public.player_progress p where p.user_id=auth.uid()),0),
    'mails',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'subject',m.subject,'body',m.body,'item_type',m.item_type,'item_amount',m.item_amount,'created_at',m.created_at,'read_at',m.read_at,'claimed_at',m.claimed_at) order by m.created_at desc) from public.user_mail m where m.user_id=auth.uid()),'[]'::jsonb),
    'daily_count',coalesce((select d.clear_count from public.daily_lesson_activity d where d.user_id=auth.uid() and d.activity_date=(now() at time zone 'Asia/Shanghai')::date),0),
    'is_admin',exists(select 1 from public.app_admins a where a.user_id=auth.uid())
  ) where auth.uid() is not null;
$$;

create or replace function public.get_friend_messages(friend_id uuid)
returns table(id bigint,sender_id uuid,receiver_id uuid,body text,created_at timestamptz)
language plpgsql security definer set search_path=public
as $$
begin
  if not exists(select 1 from public.friendships f where f.status='accepted' and auth.uid() in(f.requester_id,f.addressee_id) and friend_id in(f.requester_id,f.addressee_id)) then raise exception '对方不是你的好友'; end if;
  return query select m.id,m.sender_id,m.receiver_id,m.body,m.created_at from public.friend_messages m
  where (m.sender_id=auth.uid() and m.receiver_id=friend_id) or (m.sender_id=friend_id and m.receiver_id=auth.uid())
  order by m.created_at asc limit 300;
end;
$$;

create or replace function public.send_friend_message(friend_id uuid,message_body text)
returns void language plpgsql security definer set search_path=public
as $$
declare cleaned text:=btrim(message_body);
begin
  if char_length(cleaned)<1 or char_length(cleaned)>500 then raise exception '消息需为 1–500 个字符'; end if;
  if not exists(select 1 from public.friendships f where f.status='accepted' and auth.uid() in(f.requester_id,f.addressee_id) and friend_id in(f.requester_id,f.addressee_id)) then raise exception '对方不是你的好友'; end if;
  insert into public.friend_messages(sender_id,receiver_id,body) values(auth.uid(),friend_id,cleaned);
  insert into public.friend_sparks(user_a,user_b,current_days,last_chat_date) values(least(auth.uid(),friend_id),greatest(auth.uid(),friend_id),1,(now() at time zone 'Asia/Shanghai')::date)
  on conflict(user_a,user_b) do update set current_days=case when public.friend_sparks.last_chat_date=(now() at time zone 'Asia/Shanghai')::date then public.friend_sparks.current_days when public.friend_sparks.last_chat_date=(now() at time zone 'Asia/Shanghai')::date-1 then public.friend_sparks.current_days+1 when public.friend_sparks.last_chat_date<(now() at time zone 'Asia/Shanghai')::date-1 and public.friend_sparks.frozen then public.friend_sparks.current_days+1 else 1 end,last_chat_date=(now() at time zone 'Asia/Shanghai')::date,frozen=case when public.friend_sparks.frozen and public.friend_sparks.thaw_streak+1>=3 then false else public.friend_sparks.frozen end,thaw_streak=case when public.friend_sparks.frozen then public.friend_sparks.thaw_streak+1 else 0 end;
end;
$$;

create or replace function public.send_drift_bottle(message_body text)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if auth.uid() is null or char_length(btrim(message_body))<1 then raise exception '漂流瓶内容不能为空'; end if;
  insert into public.drift_bottles(sender_id,body) values(auth.uid(),btrim(message_body));
  insert into public.drift_bottles(sender_id,body) values(auth.uid(),'一只漂流瓶随海浪回到了你的手中。');
end;
$$;

create or replace function public.pick_drift_bottle()
returns jsonb language plpgsql security definer set search_path=public
as $$
declare bottle public.drift_bottles%rowtype;
begin
  select * into bottle from public.drift_bottles where status='floating' and sender_id<>auth.uid() order by random() limit 1 for update skip locked;
  if not found then return '{}'::jsonb; end if;
  update public.drift_bottles set status='picked',picked_by=auth.uid(),picked_at=now() where id=bottle.id;
  return jsonb_build_object('id',bottle.id,'body',bottle.body);
end;
$$;

create or replace function public.reply_drift_bottle(bottle_id bigint,reply_body text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare bottle public.drift_bottles%rowtype; crystals integer:=1+floor(random()*2)::integer;
begin
  select * into bottle from public.drift_bottles where id=bottle_id and picked_by=auth.uid() and status='picked' for update;
  if not found then raise exception '漂流瓶不存在或已经回复'; end if;
  update public.drift_bottles set status='replied',reply_body=btrim(reply_body),crystals_awarded=crystals,replied_at=now() where id=bottle_id;
  update public.player_progress set friendship_crystals=friendship_crystals+crystals where user_id in(auth.uid(),bottle.sender_id);
  return jsonb_build_object('crystals',crystals);
end;
$$;

create or replace function public.get_friend_sparks()
returns table(display_name text,display_titles text[],spark_days integer,frozen boolean)
language sql security definer set search_path=public
as $$
  select coalesce(p.display_name,'未命名玩家'),p.display_titles,s.current_days,s.frozen from public.friend_sparks s join public.player_progress p on p.user_id=case when s.user_a=auth.uid() then s.user_b else s.user_a end
  where auth.uid() in(s.user_a,s.user_b) and (s.last_chat_date is null or s.last_chat_date >= (now() at time zone 'Asia/Shanghai')::date-2) order by s.current_days desc;
$$;

create or replace function public.record_lesson_clear()
returns jsonb language plpgsql security definer set search_path=public
as $$
declare today date:=(now() at time zone 'Asia/Shanghai')::date; total integer; unlocked text[]:='{}';
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  insert into public.daily_lesson_activity(user_id,activity_date,clear_count) values(auth.uid(),today,1)
  on conflict(user_id,activity_date) do update set clear_count=public.daily_lesson_activity.clear_count+1
  returning clear_count into total;
  if total>=5 then insert into public.user_titles values(auth.uid(),'出众毅力','daily_5',now()) on conflict do nothing; if found then unlocked:=array_append(unlocked,'出众毅力'); end if; end if;
  if total>=15 then insert into public.user_titles values(auth.uid(),'高级毅力','daily_15',now()) on conflict do nothing; if found then unlocked:=array_append(unlocked,'高级毅力'); end if; end if;
  if total>=25 then insert into public.user_titles values(auth.uid(),'神级毅力','daily_25',now()) on conflict do nothing; if found then unlocked:=array_append(unlocked,'神级毅力'); end if; end if;
  return jsonb_build_object('count',total,'unlocked',to_jsonb(unlocked));
end;
$$;

create or replace function public.set_active_title(new_title text)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if not exists(select 1 from public.user_titles where user_id=auth.uid() and title=new_title and (expires_at is null or expires_at>now())) then raise exception '尚未获得该称号'; end if;
  update public.player_progress set active_title=new_title,game_state=jsonb_set(game_state,'{activeTitle}',to_jsonb(new_title),true),updated_at=now() where user_id=auth.uid();
end;
$$;

create or replace function public.set_display_titles(new_titles text[])
returns void language plpgsql security definer set search_path=public
as $$
declare cleaned text[]:=coalesce(new_titles,'{}'); first_title text:=coalesce(cleaned[1],'');
begin
  if cardinality(cleaned)>3 then raise exception '最多展示三个称号'; end if;
  if (select count(distinct u.value) from unnest(cleaned) as u(value))<>cardinality(cleaned) then raise exception '称号不能重复'; end if;
  if exists(select 1 from unnest(cleaned) as u(value) where not exists(select 1 from public.user_titles t where t.user_id=auth.uid() and t.title=u.value and (t.expires_at is null or t.expires_at>now()))) then raise exception '包含尚未获得的称号'; end if;
  update public.player_progress set display_titles=cleaned,active_title=first_title,
    game_state=jsonb_set(jsonb_set(game_state,'{displayTitles}',to_jsonb(cleaned),true),'{activeTitle}',to_jsonb(first_title),true),updated_at=now()
  where user_id=auth.uid();
end;
$$;

create or replace function public.claim_mail_attachment(mail_id bigint)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare mail_record public.user_mail%rowtype; updated_state jsonb;
begin
  select * into mail_record from public.user_mail m where m.id=mail_id and m.user_id=auth.uid() for update;
  if not found then raise exception '邮件不存在'; end if;
  if mail_record.item_type='none' then raise exception '这封邮件没有附件'; end if;
  if mail_record.claimed_at is not null then raise exception '附件已经领取'; end if;
  update public.user_mail set claimed_at=now(),read_at=coalesce(read_at,now()) where id=mail_record.id;
  update public.player_progress p set game_state=case mail_record.item_type
    when 'coins' then jsonb_set(p.game_state,'{coins}',to_jsonb(coalesce((p.game_state->>'coins')::integer,0)+mail_record.item_amount),true)
    when 'hp' then jsonb_set(p.game_state,'{hp}',to_jsonb(least(100,coalesce((p.game_state->>'hp')::integer,0)+mail_record.item_amount)),true)
    when 'spells' then jsonb_set(p.game_state,'{spells}',to_jsonb(coalesce((p.game_state->>'spells')::integer,0)+mail_record.item_amount),true)
    else p.game_state end,updated_at=now()
  where p.user_id=auth.uid() returning p.game_state into updated_state;
  return jsonb_build_object('game_state',updated_state);
end;
$$;

-- target_display 传 null 或空字符串时群发；填写玩家 ID 时单发。
create or replace function public.admin_send_mail(target_display text,mail_subject text,mail_body text,mail_item_type text,mail_item_amount integer)
returns integer language plpgsql security definer set search_path=public
as $$
declare sent integer;
begin
  if not exists(select 1 from public.app_admins where user_id=auth.uid()) then raise exception '仅管理员可以发送系统邮件'; end if;
  if mail_item_type not in('none','coins','hp','spells') then raise exception '不支持的附件类型'; end if;
  if mail_item_amount<0 then raise exception '附件数量不能为负数'; end if;
  insert into public.user_mail(user_id,subject,body,item_type,item_amount)
  select p.user_id,btrim(mail_subject),mail_body,mail_item_type,mail_item_amount from public.player_progress p
  where coalesce(btrim(target_display),'')='' or lower(p.display_name)=lower(btrim(target_display));
  get diagnostics sent=row_count;
  if sent=0 then raise exception '没有找到收件人'; end if;
  return sent;
end;
$$;

-- 在每周/每月结算时由 Supabase SQL 编辑器或定时任务调用。
create or replace function public.finalize_rank_titles(board_kind text,period_key text)
returns void language plpgsql security definer set search_path=public
as $$
declare names text[]; sources text[];
begin
  if board_kind='weekly' then names:=array['周冠军','周亚军','周季军']; sources:=array['weekly_1_'||period_key,'weekly_2_'||period_key,'weekly_3_'||period_key];
  elsif board_kind='monthly' then names:=array['月冠军','月亚军','月季军']; sources:=array['monthly_1_'||period_key,'monthly_2_'||period_key,'monthly_3_'||period_key];
  else raise exception '仅支持 weekly 或 monthly'; end if;
  insert into public.user_titles(user_id,title,source)
  select ranked.user_id,names[ranked.position],sources[ranked.position]
  from (select p.user_id,row_number() over(order by case when board_kind='weekly' then p.weekly_charges else p.monthly_charges end desc,p.updated_at asc)::integer position
    from public.player_progress p where case when board_kind='weekly' then p.week_key=period_key else p.month_key=period_key end) ranked
  where ranked.position<=3 on conflict do nothing;
end;
$$;

-- “细心大使”只能由后台执行：select public.admin_grant_special_title('玩家ID','细心大使');
create or replace function public.admin_grant_special_title(target_display text,special_title text default '细心大使')
returns void language plpgsql security definer set search_path=public
as $$
declare target_user uuid;
begin
  select user_id into target_user from public.player_progress where lower(display_name)=lower(btrim(target_display));
  if target_user is null then raise exception '玩家不存在'; end if;
  insert into public.user_titles(user_id,title,source,expires_at) values(target_user,special_title,'admin_special',case when special_title='细心大使' then now()+interval '30 days' else null end) on conflict do nothing;
end;
$$;

create or replace function public.settle_due_rank_titles()
returns void language plpgsql security definer set search_path=public
as $$
declare local_day date:=(now() at time zone 'Asia/Shanghai')::date;
begin
  if to_char(local_day,'IYYY-IW')<>to_char(local_day+1,'IYYY-IW') then
    perform public.finalize_rank_titles('weekly',to_char(local_day,'IYYY-IW'));
  end if;
  if to_char(local_day,'YYYY-MM')<>to_char(local_day+1,'YYYY-MM') then
    perform public.finalize_rank_titles('monthly',to_char(local_day,'YYYY-MM'));
  end if;
end;
$$;

revoke all on function public.finalize_rank_titles(text,text) from public,anon,authenticated;
revoke all on function public.admin_grant_special_title(text,text) from public,anon,authenticated;
revoke all on function public.settle_due_rank_titles() from public,anon,authenticated;
revoke all on function public.admin_send_mail(text,text,text,text,integer) from public,anon;
grant execute on function public.finalize_rank_titles(text,text) to service_role;
grant execute on function public.admin_grant_special_title(text,text) to service_role;
grant execute on function public.settle_due_rank_titles() to service_role;
grant execute on function public.admin_send_mail(text,text,text,text,integer) to service_role,authenticated;
grant execute on function public.get_leaderboard_v2(text),public.search_players_v2(text),public.send_friend_request(uuid),public.respond_friend_request(bigint,boolean),public.get_social_data(),public.get_friend_messages(uuid),public.send_friend_message(uuid,text),public.record_lesson_clear(),public.set_active_title(text),public.set_display_titles(text[]),public.claim_mail_attachment(bigint),public.send_drift_bottle(text),public.pick_drift_bottle(),public.reply_drift_bottle(bigint,text),public.get_friend_sparks() to authenticated;

-- 尝试启用每日 23:59（北京时间）自动结算；套餐未开放 pg_cron 时会跳过，不影响其他功能。
do $$
begin
  execute 'create extension if not exists pg_cron';
  perform cron.schedule('beisong-rank-title-settlement','59 15 * * *','select public.settle_due_rank_titles()');
exception when others then
  raise notice '未启用自动榜单结算，可在后台调用 finalize_rank_titles：% ',sqlerrm;
end;
$$;

-- 首次设置管理员：把下方邮箱替换成你的登录邮箱，在 SQL Editor 执行一次。
-- insert into public.app_admins(user_id) select id from auth.users where email='你的邮箱';
