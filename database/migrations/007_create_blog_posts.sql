
CREATE TABLE IF NOT EXISTS blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    author_user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,

    title VARCHAR(250) NOT NULL,
    slug VARCHAR(280) NOT NULL UNIQUE,

    excerpt TEXT,
    content TEXT NOT NULL,

    featured_image_url TEXT,

    category VARCHAR(100),
    tags TEXT[],

    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (
            status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')
        ),

    is_featured BOOLEAN NOT NULL DEFAULT FALSE,

    published_at TIMESTAMPTZ,

    view_count INTEGER NOT NULL DEFAULT 0
        CHECK (view_count >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_author
ON blog_posts(author_user_id);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status
ON blog_posts(status);

CREATE INDEX IF NOT EXISTS idx_blog_posts_published
ON blog_posts(published_at DESC);
