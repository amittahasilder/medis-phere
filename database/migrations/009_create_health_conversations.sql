
CREATE TABLE IF NOT EXISTS health_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    title VARCHAR(200) NOT NULL DEFAULT 'New Conversation',

    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'CLOSED', 'ARCHIVED')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_conversations_user
ON health_conversations(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_health_conversations_status
ON health_conversations(status);
