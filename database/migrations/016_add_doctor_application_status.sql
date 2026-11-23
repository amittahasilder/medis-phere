

-- Add doctor application review fields
ALTER TABLE public.doctor_profiles
ADD COLUMN IF NOT EXISTS application_status VARCHAR(20)
    NOT NULL DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS reviewed_by UUID,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;


-- Add admin reviewer foreign key
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'doctor_profiles_reviewed_by_fkey'
          AND conrelid = 'public.doctor_profiles'::regclass
    ) THEN
        ALTER TABLE public.doctor_profiles
        ADD CONSTRAINT doctor_profiles_reviewed_by_fkey
        FOREIGN KEY (reviewed_by)
        REFERENCES public.users(id)
        ON DELETE SET NULL;
    END IF;
END $$;


-- Allow only valid application statuses
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'doctor_profiles_application_status_check'
          AND conrelid = 'public.doctor_profiles'::regclass
    ) THEN
        ALTER TABLE public.doctor_profiles
        ADD CONSTRAINT doctor_profiles_application_status_check
        CHECK (
            application_status IN (
                'PENDING',
                'APPROVED',
                'REJECTED'
            )
        );
    END IF;
END $$;


-- Rejected applications must have a reason
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'doctor_profiles_rejection_reason_check'
          AND conrelid = 'public.doctor_profiles'::regclass
    ) THEN
        ALTER TABLE public.doctor_profiles
        ADD CONSTRAINT doctor_profiles_rejection_reason_check
        CHECK (
            application_status <> 'REJECTED'
            OR NULLIF(BTRIM(rejection_reason), '') IS NOT NULL
        );
    END IF;
END $$;


-- Index for admin application filtering
CREATE INDEX IF NOT EXISTS idx_doctor_profiles_application_status
ON public.doctor_profiles(application_status, created_at DESC);
