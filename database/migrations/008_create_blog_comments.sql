
CREATE TABLE IF NOT EXISTS blog_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    blog_post_id UUID NOT NULL
        REFERENCES blog_posts(id) ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,

    parent_comment_id UUID
        REFERENCES blog_comments(id) ON DELETE CASCADE,

    comment_text TEXT NOT NULL
        CHECK (char_length(trim(comment_text)) BETWEEN 1 AND 3000),

    is_approved BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blog_comments_post
ON blog_comments(blog_post_id, created_at);

CREATE INDEX IF NOT EXISTS idx_blog_comments_user
ON blog_comments(user_id);

CREATE INDEX IF NOT EXISTS idx_blog_comments_parent
ON blog_comments(parent_comment_id);
