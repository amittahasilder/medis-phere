
CREATE TABLE IF NOT EXISTS patient_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL UNIQUE
        REFERENCES users(id) ON DELETE CASCADE,

    date_of_birth DATE,
    
    gender VARCHAR(20)
        CHECK (gender IN ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY')),

    blood_group VARCHAR(5)
        CHECK (
            blood_group IN (
                'A+', 'A-', 'B+', 'B-',
                'AB+', 'AB-', 'O+', 'O-'
            )
        ),

    height_cm NUMERIC(5,2),
    weight_kg NUMERIC(5,2),

    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100),

    emergency_contact_name VARCHAR(150),
    emergency_contact_phone VARCHAR(20),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patient_profiles_user_id
ON patient_profiles(user_id);
