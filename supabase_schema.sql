-- ============================================================
-- HenrysTV — Supabase Schema Migration
-- Chạy toàn bộ file này trong Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. PROFILES (sync với auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email        TEXT NOT NULL,
  display_name TEXT,
  role         TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Helper: kiểm tra admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  )
$$;

-- Trigger: tự tạo profile khi user đăng ký
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN NEW.email = 'cotuongxastress@gmail.com' THEN 'admin' ELSE 'user' END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Profiles RLS policies
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.is_admin());
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid() OR public.is_admin());
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL USING (public.is_admin());


-- 2. PACKAGES (gói đăng ký)
CREATE TABLE IF NOT EXISTS public.packages (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  duration_days INTEGER NOT NULL DEFAULT 30,
  price        NUMERIC(12,0) DEFAULT 0,
  features     JSONB DEFAULT '[]',
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "packages_select" ON public.packages;
DROP POLICY IF EXISTS "packages_admin_write" ON public.packages;

CREATE POLICY "packages_select" ON public.packages
  FOR SELECT USING (is_active = TRUE OR public.is_admin());
CREATE POLICY "packages_admin_write" ON public.packages
  FOR ALL USING (public.is_admin());

-- Gói mặc định
INSERT INTO public.packages (name, description, duration_days, price, features) VALUES
  ('Free Trial', 'Dùng thử 7 ngày miễn phí', 7, 0,
   '["Tạo outline script","SEO cơ bản","Lưu tối đa 5 projects"]'::jsonb),
  ('Basic', 'Gói cơ bản 30 ngày', 30, 99000,
   '["Tất cả tính năng","Lưu tối đa 30 projects","Lưu API keys"]'::jsonb),
  ('Pro', 'Gói chuyên nghiệp 30 ngày', 30, 299000,
   '["Tất cả tính năng","Unlimited projects","Lưu API keys","Ưu tiên hỗ trợ"]'::jsonb)
ON CONFLICT DO NOTHING;


-- 3. SUBSCRIPTIONS (đăng ký gói)
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  package_id   UUID REFERENCES public.packages(id) ON DELETE SET NULL,
  package_name TEXT NOT NULL,
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  notes        TEXT,
  created_by   UUID REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_select" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_admin_all" ON public.subscriptions;

CREATE POLICY "subscriptions_select" ON public.subscriptions
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "subscriptions_admin_all" ON public.subscriptions
  FOR ALL USING (public.is_admin());


-- 4. API KEYS (lưu các API key của user)
CREATE TABLE IF NOT EXISTS public.api_keys (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  key_name   TEXT NOT NULL,
  key_value  TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT api_keys_user_key_name UNIQUE (user_id, key_name)
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_keys_own" ON public.api_keys;

CREATE POLICY "api_keys_own" ON public.api_keys
  FOR ALL USING (user_id = auth.uid() OR public.is_admin());


-- 5. PROJECTS (lưu project)
CREATE TABLE IF NOT EXISTS public.projects (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'full',
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Trigger: tự set expires_at = 72h cho user (admin không hết hạn)
CREATE OR REPLACE FUNCTION public.set_project_expiry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = NEW.user_id;
  IF v_role = 'user' THEN
    NEW.expires_at := NOW() + INTERVAL '72 hours';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_expiry ON public.projects;
CREATE TRIGGER trg_project_expiry
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_project_expiry();

-- Hàm dọn dẹp project hết hạn (gọi qua cron hoặc admin)
CREATE OR REPLACE FUNCTION public.cleanup_expired_projects()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM public.projects WHERE expires_at IS NOT NULL AND expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Projects RLS policies
DROP POLICY IF EXISTS "projects_select" ON public.projects;
DROP POLICY IF EXISTS "projects_insert" ON public.projects;
DROP POLICY IF EXISTS "projects_update" ON public.projects;
DROP POLICY IF EXISTS "projects_delete" ON public.projects;

CREATE POLICY "projects_select" ON public.projects
  FOR SELECT USING (
    (user_id = auth.uid() AND (expires_at IS NULL OR expires_at > NOW()))
    OR public.is_admin()
  );
CREATE POLICY "projects_insert" ON public.projects
  FOR INSERT WITH CHECK (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "projects_update" ON public.projects
  FOR UPDATE USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "projects_delete" ON public.projects
  FOR DELETE USING (user_id = auth.uid() OR public.is_admin());
