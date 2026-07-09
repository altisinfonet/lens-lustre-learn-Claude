
CREATE TABLE public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  subject text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  body_text text NOT NULL DEFAULT '',
  variables text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage email templates"
  ON public.email_templates FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can view active templates"
  ON public.email_templates FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Seed default templates
INSERT INTO public.email_templates (template_key, name, category, subject, body_html, variables) VALUES
('welcome', 'Welcome Email', 'welcome', 'Welcome to {{site_name}}!', '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#333">Welcome, {{user_name}}!</h1><p style="color:#666;line-height:1.6">Thank you for joining <strong>{{site_name}}</strong>. We''re excited to have you as part of our photography community.</p><p style="color:#666">Start exploring competitions, courses, and connect with fellow photographers.</p><div style="text-align:center;margin:30px 0"><a href="{{site_url}}" style="background:#000;color:#fff;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block">Get Started</a></div><p style="color:#999;font-size:12px">— The {{site_name}} Team</p></div>', '{user_name,user_email,site_name,site_url}'),

('competition_entry_confirmed', 'Competition Entry Confirmed', 'competition', 'Entry Confirmed: {{competition_title}}', '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#333">Entry Confirmed!</h1><p style="color:#666;line-height:1.6">Hi {{user_name}}, your entry <strong>"{{entry_title}}"</strong> has been submitted to <strong>{{competition_title}}</strong>.</p><p style="color:#666">We''ll notify you when results are announced. Good luck!</p><p style="color:#999;font-size:12px">— {{site_name}}</p></div>', '{user_name,competition_title,entry_title,site_name}'),

('competition_winner', 'Competition Winner', 'competition', 'Congratulations! You won {{competition_title}}', '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#333">🏆 Congratulations, {{user_name}}!</h1><p style="color:#666;line-height:1.6">Your entry <strong>"{{entry_title}}"</strong> has won in <strong>{{competition_title}}</strong>!</p><p style="color:#666">Placement: <strong>{{placement}}</strong></p><div style="text-align:center;margin:30px 0"><a href="{{result_url}}" style="background:#000;color:#fff;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block">View Results</a></div><p style="color:#999;font-size:12px">— {{site_name}}</p></div>', '{user_name,competition_title,entry_title,placement,result_url,site_name}'),

('wallet_deposit', 'Wallet Deposit Confirmed', 'wallet', 'Deposit of {{amount}} Confirmed', '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#333">Deposit Confirmed</h1><p style="color:#666;line-height:1.6">Hi {{user_name}}, your deposit of <strong>{{amount}}</strong> has been confirmed.</p><p style="color:#666">New balance: <strong>{{new_balance}}</strong></p><p style="color:#999;font-size:12px">— {{site_name}}</p></div>', '{user_name,amount,new_balance,site_name}'),

('wallet_withdrawal', 'Withdrawal Status Update', 'wallet', 'Withdrawal {{status}}: {{amount}}', '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#333">Withdrawal {{status}}</h1><p style="color:#666;line-height:1.6">Hi {{user_name}}, your withdrawal request of <strong>{{amount}}</strong> has been <strong>{{status}}</strong>.</p>{{#if admin_note}}<p style="color:#666">Note: {{admin_note}}</p>{{/if}}<p style="color:#999;font-size:12px">— {{site_name}}</p></div>', '{user_name,amount,status,admin_note,site_name}'),

('gift_credit', 'You Received a Gift Credit!', 'wallet', 'You received {{amount}} credits!', '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#333">🎁 Gift Credit!</h1><p style="color:#666;line-height:1.6">Hi {{user_name}}, you''ve received <strong>{{amount}}</strong> credits!</p><p style="color:#666">Reason: {{reason}}</p>{{#if expires_at}}<p style="color:#e67e22">Expires: {{expires_at}}</p>{{/if}}<p style="color:#999;font-size:12px">— {{site_name}}</p></div>', '{user_name,amount,reason,expires_at,site_name}'),

('course_enrollment', 'Course Enrollment Confirmed', 'course', 'Enrolled: {{course_title}}', '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#333">Course Enrolled!</h1><p style="color:#666;line-height:1.6">Hi {{user_name}}, you''ve successfully enrolled in <strong>{{course_title}}</strong>.</p><div style="text-align:center;margin:30px 0"><a href="{{course_url}}" style="background:#000;color:#fff;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block">Start Learning</a></div><p style="color:#999;font-size:12px">— {{site_name}}</p></div>', '{user_name,course_title,course_url,site_name}'),

('course_completed', 'Course Completed!', 'course', 'Congratulations on completing {{course_title}}', '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#333">🎓 Course Complete!</h1><p style="color:#666;line-height:1.6">Congratulations {{user_name}}, you''ve completed <strong>{{course_title}}</strong>!</p><p style="color:#666">Your certificate is now available in your profile.</p><div style="text-align:center;margin:30px 0"><a href="{{certificate_url}}" style="background:#000;color:#fff;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block">View Certificate</a></div><p style="color:#999;font-size:12px">— {{site_name}}</p></div>', '{user_name,course_title,certificate_url,site_name}'),

('general_notification', 'General Notification', 'general', '{{subject}}', '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px"><h1 style="color:#333">{{title}}</h1><p style="color:#666;line-height:1.6">{{message}}</p>{{#if action_url}}<div style="text-align:center;margin:30px 0"><a href="{{action_url}}" style="background:#000;color:#fff;padding:12px 30px;text-decoration:none;border-radius:6px;display:inline-block">{{action_text}}</a></div>{{/if}}<p style="color:#999;font-size:12px">— {{site_name}}</p></div>', '{title,message,action_url,action_text,site_name,subject}');
