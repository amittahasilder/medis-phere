
CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    plan_code VARCHAR(50) NOT NULL UNIQUE,
    plan_name VARCHAR(100) NOT NULL,

    description TEXT,

    price NUMERIC(10,2) NOT NULL DEFAULT 0
        CHECK (price >= 0),

    currency VARCHAR(3) NOT NULL DEFAULT 'BDT',

    billing_interval VARCHAR(20) NOT NULL DEFAULT 'MONTHLY'
        CHECK (
            billing_interval IN ('MONTHLY', 'YEARLY', 'LIFETIME')
        ),

    features JSONB NOT NULL DEFAULT '[]'::jsonb,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_active
ON subscription_plans(is_active);
