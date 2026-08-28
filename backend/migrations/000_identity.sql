-- 000_identity.sql — 신원(identity) 테이블. 001보다 **먼저** 적용한다.
--
-- 결정 2026-08-28: Better Auth는 지금 쓰지 않는다. 다만 나중에 켤 수 있으므로
-- 테이블 이름과 컬럼 모양을 Better Auth 코어 user 스키마에 맞춰 우리가 선점한다.
--   · 001_app_auth.sql이 `references "user"(id)`를 4곳에서 걸고 있어 이 파일 없이는
--     첫 구문에서 `relation "user" does not exist`로 멈춘다.
--   · FK를 걷어내는 대안 대신 이 길을 택했다 — 001을 한 글자도 고치지 않아도 되고,
--     나중에 Better Auth를 켜면 session/account/verification 3개만 추가하면 된다.
--   · 그때 컬럼명이 어긋나면 ALTER 한 번으로 끝난다(@better-auth/cli로 SQL을 뽑아 대조).
--
-- ⚠️ AUTH_MODE=demo인 동안 이 테이블을 채우는 것은 아래 seed뿐이다.
--    회원가입 경로가 생기면(Better Auth 또는 자체 구현) 그쪽이 INSERT를 맡는다.

create table if not exists "user" (
  id text primary key,
  name text not null default '',
  email text not null unique,
  "emailVerified" boolean not null default false,
  image text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- 데모 4명. id는 backend/src/store/memory.ts:29-33과 동일해야 한다 —
-- AUTH_MODE=demo에서 battery_asset.owner_user_id가 이 값을 그대로 쓴다.
-- DemoUser.joinedAt = "user"."createdAt".
insert into "user" (id, name, email, "createdAt", "updatedAt") values
  ('hong',     '홍길동',   'hong@cellguard.io', timestamptz '2025-03-12 00:00:00+00', timestamptz '2025-03-12 00:00:00+00'),
  ('kimeng',   '김엔지',   'kim@lab.io',        timestamptz '2024-11-02 00:00:00+00', timestamptz '2024-11-02 00:00:00+00'),
  ('leelab',   '이연구',   'lee@lab.io',        timestamptz '2024-08-19 00:00:00+00', timestamptz '2024-08-19 00:00:00+00'),
  ('parktest', '박테스트', 'park@test.io',      timestamptz '2025-06-10 00:00:00+00', timestamptz '2025-06-10 00:00:00+00')
on conflict (id) do nothing;
