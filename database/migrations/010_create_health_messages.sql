
CREATE TABLE IF NOT EXISTS health_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    conversation_id UUID NOT NULL
        REFERENCES health_conversations(id) ON DELETE CASCADE,

    sender_type VARCHAR(20) NOT NULL
        CHECK (
            sender_type IN ('USER', 'AI', 'DOCTOR', 'SYSTEM')
        ),

    message_text TEXT NOT NULL
        CHECK (char_length(trim(message_text)) BETWEEN 1 AND 10000),

    message_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_messages_conversation
ON health_messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_health_messages_sender
ON health_messages(sender_type);
