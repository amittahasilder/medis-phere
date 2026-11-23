
BEGIN;

-- Enable GiST support for UUID equality comparisons
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Store each doctor's local timezone
ALTER TABLE public.doctor_profiles
ADD COLUMN IF NOT EXISTS timezone VARCHAR(64)
NOT NULL DEFAULT 'UTC';

-- Ensure timezone is not empty
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'doctor_profiles_timezone_check'
          AND conrelid = 'public.doctor_profiles'::regclass
    ) THEN
        ALTER TABLE public.doctor_profiles
        ADD CONSTRAINT doctor_profiles_timezone_check
        CHECK (LENGTH(BTRIM(timezone)) > 0);
    END IF;
END $$;

-- Prevent overlapping active appointments
-- PENDING and CONFIRMED appointments reserve the time slot.
-- CANCELLED and REJECTED appointments do not reserve it.
-- Adjacent appointments (09:00-09:30 and 09:30-10:00) are allowed.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'appointments_no_overlapping_active_doctor_bookings'
          AND conrelid = 'public.appointments'::regclass
    ) THEN
        ALTER TABLE public.appointments
        ADD CONSTRAINT appointments_no_overlapping_active_doctor_bookings
        EXCLUDE USING GIST (
            doctor_profile_id WITH =,
            tstzrange(
                appointment_date,
                appointment_end,
                '[)'
            ) WITH &&
        )
        WHERE (
            status IN ('PENDING', 'CONFIRMED')
        );
    END IF;
END $$;

COMMIT;
