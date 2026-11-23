
CREATE TABLE IF NOT EXISTS doctor_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    appointment_id UUID NOT NULL UNIQUE
        REFERENCES appointments(id) ON DELETE RESTRICT,

    patient_user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,

    doctor_profile_id UUID NOT NULL
        REFERENCES doctor_profiles(id) ON DELETE RESTRICT,

    rating SMALLINT NOT NULL
        CHECK (rating BETWEEN 1 AND 5),

    review_text TEXT,

    is_visible BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctor_reviews_doctor
ON doctor_reviews(doctor_profile_id);

CREATE INDEX IF NOT EXISTS idx_doctor_reviews_patient
ON doctor_reviews(patient_user_id);
