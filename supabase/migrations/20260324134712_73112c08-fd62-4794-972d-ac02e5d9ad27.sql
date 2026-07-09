
-- Badge definitions table (replaces hardcoded badgeConfig)
CREATE TABLE public.badge_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_key text UNIQUE NOT NULL,
  label text NOT NULL,
  icon text NOT NULL DEFAULT '⭐',
  badge_class text NOT NULL DEFAULT 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  ribbon_class text NOT NULL DEFAULT 'bg-gradient-to-r from-amber-500 to-yellow-400 text-white shadow-amber-500/30',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed with existing badge definitions
INSERT INTO public.badge_definitions (type_key, label, icon, badge_class, ribbon_class, sort_order) VALUES
  ('top_rated', 'Top Rated', '⭐', 'bg-amber-500/15 text-amber-600 border-amber-500/30', 'bg-gradient-to-r from-amber-500 to-yellow-400 text-white shadow-amber-500/30', 1),
  ('verified', 'Verified', '✓', 'bg-blue-500/15 text-blue-600 border-blue-500/30', 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white shadow-blue-500/30', 2),
  ('most_popular', 'Most Popular', '🔥', 'bg-pink-500/15 text-pink-600 border-pink-500/30', 'bg-gradient-to-r from-pink-500 to-rose-400 text-white shadow-pink-500/30', 3),
  ('most_trusted', 'Most Trusted', '🛡', 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30', 'bg-gradient-to-r from-emerald-500 to-green-400 text-white shadow-emerald-500/30', 4),
  ('rising_star', 'Rising Star', '🚀', 'bg-violet-500/15 text-violet-600 border-violet-500/30', 'bg-gradient-to-r from-violet-500 to-purple-400 text-white shadow-violet-500/30', 5);

-- Role display config table (replaces hardcoded roleConfig)
CREATE TABLE public.role_display_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key text UNIQUE NOT NULL,
  label text NOT NULL,
  icon text NOT NULL DEFAULT '',
  pill_class text NOT NULL DEFAULT 'bg-muted text-muted-foreground border-border',
  show_inline boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed with existing role display configs
INSERT INTO public.role_display_config (role_key, label, icon, pill_class, show_inline, sort_order) VALUES
  ('admin', 'Admin', '🛡', 'bg-red-500/15 text-red-600 border-red-500/30', false, 1),
  ('judge', 'Judge', '⚖', 'bg-amber-500/15 text-amber-600 border-amber-500/30', true, 2),
  ('content_editor', 'Editor', '✎', 'bg-indigo-500/15 text-indigo-600 border-indigo-500/30', true, 3),
  ('registered_photographer', 'Photographer', '📷', 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30', true, 4),
  ('student', 'Student', '🎓', 'bg-sky-500/15 text-sky-600 border-sky-500/30', true, 5),
  ('user', 'User', '', 'bg-muted text-muted-foreground border-border', false, 6);

-- RLS
ALTER TABLE public.badge_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_display_config ENABLE ROW LEVEL SECURITY;

-- Anyone can read definitions
CREATE POLICY "Anyone can view badge definitions" ON public.badge_definitions FOR SELECT TO public USING (true);
CREATE POLICY "Anyone can view role display config" ON public.role_display_config FOR SELECT TO public USING (true);

-- Only admins can manage
CREATE POLICY "Admins can manage badge definitions" ON public.badge_definitions FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can manage role display config" ON public.role_display_config FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
