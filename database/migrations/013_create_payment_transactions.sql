
CREATE TABLE IF NOT EXISTS payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,

    subscription_id UUID
        REFERENCES user_subscriptions(id) ON DELETE RESTRICT,

    amount NUMERIC(10,2) NOT NULL
        CHECK (amount > 0),

    currency VARCHAR(3) NOT NULL DEFAULT 'BDT',

    payment_method VARCHAR(30) NOT NULL
        CHECK (
            payment_method IN (
                'BKASH',
                'NAGAD',
                'ROCKET',
                'CARD',
                'BANK',
                'OTHER'
            )
        ),

    transaction_id VARCHAR(150) UNIQUE,

    provider_reference VARCHAR(150),

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'SUCCESS',
                'FAILED',
                'REFUNDED'
            )
        ),

    paid_at TIMESTAMPTZ,

    payment_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_user
ON payment_transactions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_status
ON payment_transactions(status);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_subscription
ON payment_transactions(subscription_id);
