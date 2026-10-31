
-- Seed Photo of the Day demo content
INSERT INTO public.photo_of_the_day (title, image_url, photographer_name, description, featured_date, source_type, created_by, is_active)
VALUES
  ('The Golden Hour', 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1200&h=800&fit=crop', 'Ananya Sharma', 'A breathtaking sunset over the wetlands, where golden light dances across still waters.', CURRENT_DATE, 'custom', '4c200b33-ae64-46f0-ba5d-1a97152e6a6c', true),
  ('Monsoon Dreams', 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=1200&h=800&fit=crop', 'Ravi Mehta', 'Rain-soaked streets of old Delhi reflecting the chaos and beauty of monsoon season.', CURRENT_DATE - INTERVAL '1 day', 'custom', '4c200b33-ae64-46f0-ba5d-1a97152e6a6c', false);

-- Seed Featured Artist demo content
INSERT INTO public.featured_artists (title, slug, excerpt, body, cover_image_url, artist_name, artist_bio, artist_avatar_url, tags, photo_gallery, created_by, is_active, published_at)
VALUES
  (
    'Through the Lens of Light',
    'through-the-lens-of-light',
    'Exploring the interplay of shadow and illumination in documentary photography across rural India.',
    'Photography, at its core, is the art of capturing light. For documentary photographer Priya Nair, this principle takes on a deeper meaning as she traverses the villages and small towns of rural India, seeking out moments where light itself becomes the storyteller.

"I never use artificial light," Priya explains, sitting in her modest studio in Kochi. "The sun, a kerosene lamp, the glow of a cooking fire — these are the lights that define the lives I photograph. To introduce anything else would be to impose my narrative on theirs."

[img:https://images.unsplash.com/photo-1509281373149-e957c6296406?w=1200&h=800&fit=crop]

Her journey began almost by accident. A software engineer by training, Priya bought her first camera — a second-hand Canon — during a trip to Hampi in 2018. "I was supposed to photograph ruins," she laughs. "Instead, I spent the entire trip photographing the women who sold flowers near the temple. Their faces in the morning light were more magnificent than any stone carving."

That trip changed everything. Within a year, she had left her job, enrolled in a short course at the National Institute of Design, and begun what would become her life''s work: documenting the everyday poetry of Indian rural life.

Her most acclaimed series, "Before Dawn," captures the pre-sunrise rituals of fishing communities along the Kerala backwaters. Shot entirely in available darkness and the first hints of dawn, the images have an almost painterly quality — figures emerging from shadow, silhouettes against water that mirrors the sky.

[img:https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&h=800&fit=crop]

"The hour before sunrise is sacred," she says. "Not in a religious sense, but in a photographic one. The world is still deciding what it wants to look like. Everything is possibility."

Her work has been exhibited at the India International Centre, the Kochi-Muziris Biennale, and the National Gallery of Modern Art. Yet she remains deeply connected to the communities she photographs, often returning to the same villages year after year, building relationships that give her images their remarkable intimacy.

"Photography without relationship is surveillance," she states firmly. "I photograph people I know, people who trust me, people whose stories I have earned the right to tell."

For aspiring documentary photographers, Priya offers simple advice: "Slow down. Stay longer than you think you need to. The best photograph is always the one you almost missed because you were about to leave."',
    'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=1200&h=900&fit=crop',
    'Priya Nair',
    'Documentary photographer based in Kochi, India. Known for her intimate portrayals of rural life and masterful use of natural light.',
    'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop&crop=face',
    ARRAY['Documentary', 'Portrait', 'Natural Light'],
    ARRAY['https://images.unsplash.com/photo-1509281373149-e957c6296406?w=800&h=600&fit=crop', 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=800&h=600&fit=crop', 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&h=600&fit=crop', 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=800&h=600&fit=crop'],
    '4c200b33-ae64-46f0-ba5d-1a97152e6a6c',
    true,
    NOW()
  );
