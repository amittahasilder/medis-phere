
CREATE TABLE IF NOT EXISTS doctor_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    doctor_profile_id UUID NOT NULL
        REFERENCES doctor_profiles(id) ON DELETE CASCADE,

    day_of_week SMALLINT NOT NULL
        CHECK (day_of_week BETWEEN 0 AND 6),

    start_time TIME NOT NULL,
    end_time TIME NOT NULL,

    slot_duration_minutes INTEGER NOT NULL DEFAULT 30
        CHECK (slot_duration_minutes BETWEEN 10 AND 180),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_availability_time
        CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_doctor_availability_doctor
ON doctor_availability(doctor_profile_id);

CREATE INDEX IF NOT EXISTS idx_doctor_availability_day
ON doctor_availability(day_of_week);
