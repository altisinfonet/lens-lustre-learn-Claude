
-- Phase 2: Admin notification triggers

-- 1. Notify admins on new role application
CREATE OR REPLACE FUNCTION notify_admin_role_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  applicant_name text;
BEGIN
  SELECT full_name INTO applicant_name FROM profiles_public_data WHERE id = NEW.user_id;
  INSERT INTO admin_notifications (type, title, message, reference_id)
  VALUES (
    'role_application',
    'New Role Application',
    COALESCE(applicant_name, 'A user') || ' applied for ' || NEW.requested_role::text || ' role',
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_admin_notify_role_application
  AFTER INSERT ON role_applications
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_role_application();

-- 2. Notify admins on new post reports
CREATE OR REPLACE FUNCTION notify_admin_post_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO admin_notifications (type, title, message, reference_id)
  VALUES (
    'post_report',
    'New Post Report',
    'A post has been reported for: ' || NEW.reason,
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_admin_notify_post_report
  AFTER INSERT ON post_reports
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_post_report();

-- 3. Notify admins on new comment reports
CREATE OR REPLACE FUNCTION notify_admin_comment_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO admin_notifications (type, title, message, reference_id)
  VALUES (
    'comment_report',
    'New Comment Report',
    'A comment has been reported for: ' || NEW.reason,
    NEW.id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_admin_notify_comment_report
  AFTER INSERT ON comment_reports
  FOR EACH ROW
  EXECUTE FUNCTION notify_admin_comment_report();

-- Phase 3: User notification triggers

-- 4. Notify user when friend request is accepted
CREATE OR REPLACE FUNCTION notify_friend_request_accepted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  accepter_name text;
BEGIN
  IF OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    SELECT full_name INTO accepter_name FROM profiles_public_data WHERE id = NEW.addressee_id;
    INSERT INTO user_notifications (user_id, type, title, message, actor_id, reference_id)
    VALUES (
      NEW.requester_id,
      'friend_accepted',
      'Friend Request Accepted',
      COALESCE(accepter_name, 'Someone') || ' accepted your friend request',
      NEW.addressee_id,
      NEW.addressee_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_friend_accepted
  AFTER UPDATE ON friendships
  FOR EACH ROW
  EXECUTE FUNCTION notify_friend_request_accepted();

-- 5. Notify user when role application is approved or rejected
CREATE OR REPLACE FUNCTION notify_role_application_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    INSERT INTO user_notifications (user_id, type, title, message, reference_id)
    VALUES (
      NEW.user_id,
      CASE WHEN NEW.status = 'approved' THEN 'role_approved' ELSE 'role_rejected' END,
      'Role Application ' || initcap(NEW.status),
      'Your application for ' || NEW.requested_role::text || ' role has been ' || NEW.status ||
        CASE WHEN NEW.admin_message IS NOT NULL AND NEW.admin_message != '' THEN ': ' || NEW.admin_message ELSE '' END,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_role_decision
  AFTER UPDATE ON role_applications
  FOR EACH ROW
  EXECUTE FUNCTION notify_role_application_decision();
