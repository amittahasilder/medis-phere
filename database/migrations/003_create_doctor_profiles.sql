
CREATE TABLE IF NOT EXISTS doctor_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL UNIQUE
        REFERENCES users(id) ON DELETE CASCADE,

    specialization VARCHAR(150) NOT NULL,
    qualification TEXT NOT NULL,

    medical_license_number VARCHAR(100) NOT NULL UNIQUE,

    experience_years INTEGER NOT NULL DEFAULT 0
        CHECK (experience_years >= 0),

    consultation_fee NUMERIC(10,2) NOT NULL DEFAULT 0
        CHECK (consultation_fee >= 0),

    bio TEXT,
    clinic_name VARCHAR(200),
    clinic_address TEXT,

    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_available BOOLEAN NOT NULL DEFAULT FALSE,

    average_rating NUMERIC(3,2) NOT NULL DEFAULT 0
        CHECK (average_rating BETWEEN 0 AND 5),

    total_reviews INTEGER NOT NULL DEFAULT 0
        CHECK (total_reviews >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctor_profiles_user_id
ON doctor_profiles(user_id);

CREATE INDEX IF NOT EXISTS idx_doctor_profiles_specialization
ON doctor_profiles(specialization);

CREATE INDEX IF NOT EXISTS idx_doctor_profiles_verified
ON doctor_profiles(is_verified);
