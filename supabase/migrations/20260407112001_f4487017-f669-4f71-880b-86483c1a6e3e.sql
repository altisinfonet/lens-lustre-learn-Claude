
-- Performance indexes for scaling to 100K-1M users

-- Feed: speed up feed queries sorted by created_at
CREATE INDEX IF NOT EXISTS idx_posts_user_created ON public.posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_privacy_created ON public.posts (privacy, created_at DESC);

-- Post reactions: speed up reaction counts and per-user lookups
CREATE INDEX IF NOT EXISTS idx_post_reactions_post_user ON public.post_reactions (post_id, user_id);

-- Post comments: speed up comment fetching per post
CREATE INDEX IF NOT EXISTS idx_post_comments_post_created ON public.post_comments (post_id, created_at DESC);

-- Competition entries: speed up entry listing per competition
CREATE INDEX IF NOT EXISTS idx_comp_entries_comp_status ON public.competition_entries (competition_id, status);
CREATE INDEX IF NOT EXISTS idx_comp_entries_user ON public.competition_entries (user_id, created_at DESC);

-- Competition votes: speed up vote counts per entry
CREATE INDEX IF NOT EXISTS idx_comp_votes_entry ON public.competition_votes (entry_id);

-- Wallet transactions: speed up wallet page queries
CREATE INDEX IF NOT EXISTS idx_wallet_txn_user_created ON public.wallet_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_txn_status ON public.wallet_transactions (status) WHERE status = 'pending';

-- Friendships: speed up friend lookups
CREATE INDEX IF NOT EXISTS idx_friendships_requester_status ON public.friendships (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee_status ON public.friendships (addressee_id, status);

-- Follows: speed up follower/following counts
CREATE INDEX IF NOT EXISTS idx_follows_follower ON public.follows (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON public.follows (following_id);

-- User notifications: speed up unread badge count
CREATE INDEX IF NOT EXISTS idx_user_notif_user_read ON public.user_notifications (user_id, is_read) WHERE is_read = false;

-- Activity logs: speed up admin log browsing
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created ON public.activity_logs (user_id, created_at DESC);

-- Profiles public: speed up search
CREATE INDEX IF NOT EXISTS idx_profiles_public_fullname ON public.profiles_public_data (full_name);

-- Judge scores: speed up per-entry score aggregation
CREATE INDEX IF NOT EXISTS idx_judge_scores_entry ON public.judge_scores (entry_id);

-- Withdrawal requests: speed up admin review queue
CREATE INDEX IF NOT EXISTS idx_withdrawal_status ON public.withdrawal_requests (status) WHERE status = 'pending';
