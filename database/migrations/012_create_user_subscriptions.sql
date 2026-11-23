
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,

    plan_id UUID NOT NULL
        REFERENCES subscription_plans(id) ON DELETE RESTRICT,

    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (
            status IN (
                'ACTIVE',
                'CANCELLED',
                'EXPIRED',
                'PAST_DUE'
            )
        ),

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,

    cancelled_at TIMESTAMPTZ,

    auto_renew BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_subscription_period
        CHECK (expires_at IS NULL OR expires_at > started_at)
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user
ON user_subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_plan
ON user_subscriptions(plan_id);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status
ON user_subscriptions(status);
