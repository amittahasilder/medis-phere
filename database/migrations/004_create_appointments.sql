
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    patient_user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,

    doctor_profile_id UUID NOT NULL
        REFERENCES doctor_profiles(id) ON DELETE RESTRICT,

    appointment_date TIMESTAMPTZ NOT NULL,
    appointment_end TIMESTAMPTZ NOT NULL,

    consultation_type VARCHAR(20) NOT NULL DEFAULT 'VIDEO'
        CHECK (
            consultation_type IN ('VIDEO', 'IN_PERSON')
        ),

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (
            status IN (
                'PENDING',
                'CONFIRMED',
                'COMPLETED',
                'CANCELLED',
                'REJECTED'
            )
        ),

    reason TEXT,
    consultation_fee NUMERIC(10,2) NOT NULL DEFAULT 0
        CHECK (consultation_fee >= 0),

    cancellation_reason TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT valid_appointment_time
        CHECK (appointment_end > appointment_date)
);

CREATE INDEX IF NOT EXISTS idx_appointments_patient
ON appointments(patient_user_id, appointment_date DESC);

CREATE INDEX IF NOT EXISTS idx_appointments_doctor
ON appointments(doctor_profile_id, appointment_date);

CREATE INDEX IF NOT EXISTS idx_appointments_status
ON appointments(status);
