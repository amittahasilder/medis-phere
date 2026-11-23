
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
type DoctorRow = {
  id: string;
  timezone: string;
  consultation_fee: string;
  is_available: boolean;
};

type SlotRow = {
  starts_at: Date;
  ends_at: Date;
  start_time: string;
  end_time: string;
};

type RouteContext = {
  params: Promise<{
    doctorProfileId: string;
  }>;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { doctorProfileId } = await context.params;

    // Validate doctor profile ID
    if (!UUID_REGEX.test(doctorProfileId)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid doctor profile ID.",
        },
        { status: 400 }
      );
    }

    // Read requested date
    const date = request.nextUrl.searchParams.get("date");

    if (!date || !DATE_REGEX.test(date)) {
      return NextResponse.json(
        {
          success: false,
          message: "A valid date is required. Use YYYY-MM-DD.",
        },
        { status: 400 }
      );
    }

    // Reject impossible calendar dates
    const parsedDate = new Date(`${date}T00:00:00.000Z`);

    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid calendar date.",
        },
        { status: 400 }
      );
    }

    // Get publicly bookable doctor profile
    const doctorResult = await pool.query<DoctorRow>(
      `
      SELECT
        dp.id,
        dp.timezone,
        dp.consultation_fee,
        dp.is_available
      FROM doctor_profiles dp
      INNER JOIN users u
        ON u.id = dp.user_id
      WHERE dp.id = $1
        AND dp.is_verified = TRUE
        AND dp.application_status = 'APPROVED'
        AND u.role = 'DOCTOR'
        AND u.is_active = TRUE
      LIMIT 1
      `,
      [doctorProfileId]
    );

    if (doctorResult.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Doctor not found or not publicly available.",
        },
        { status: 404 }
      );
    }

    const doctor = doctorResult.rows[0];

    // Doctor has switched availability OFF
    if (!doctor.is_available) {
      return NextResponse.json({
        success: true,
        doctorProfileId: doctor.id,
        date,
        timezone: doctor.timezone,
        consultationFee: Number(doctor.consultation_fee),
        slots: [],
        message: "Doctor is currently unavailable.",
      });
    }

    /*
      Generate slots using the doctor's local timezone.

      PostgreSQL converts local date/time to timestamptz
      using the doctor's saved timezone.

      Existing PENDING and CONFIRMED appointments
      are excluded from the available slots.
    */
    const slotsResult = await pool.query<SlotRow>(
      `
      SELECT
        (
          generated.local_start AT TIME ZONE d.timezone
        ) AS starts_at,

        (
          (
            generated.local_start
            + da.slot_duration_minutes * INTERVAL '1 minute'
          ) AT TIME ZONE d.timezone
        ) AS ends_at,

        TO_CHAR(
          generated.local_start,
          'HH24:MI'
        ) AS start_time,

        TO_CHAR(
          generated.local_start
          + da.slot_duration_minutes * INTERVAL '1 minute',
          'HH24:MI'
        ) AS end_time

      FROM doctor_profiles d

      INNER JOIN doctor_availability da
        ON da.doctor_profile_id = d.id

      CROSS JOIN LATERAL generate_series(
        ($2::date + da.start_time),
        (
          ($2::date + da.end_time)
          - da.slot_duration_minutes * INTERVAL '1 minute'
        ),
        da.slot_duration_minutes * INTERVAL '1 minute'
      ) AS generated(local_start)

      WHERE d.id = $1
        AND da.is_active = TRUE
        AND da.day_of_week = EXTRACT(DOW FROM $2::date)::SMALLINT

        -- Do not return slots that have already started
        AND (
          generated.local_start AT TIME ZONE d.timezone
        ) > NOW()

        -- Exclude slots overlapping active appointments
        AND NOT EXISTS (
          SELECT 1
          FROM appointments a
          WHERE a.doctor_profile_id = d.id
            AND a.status IN ('PENDING', 'CONFIRMED')
            AND tstzrange(
              a.appointment_date,
              a.appointment_end,
              '[)'
            ) && tstzrange(
              (
                generated.local_start AT TIME ZONE d.timezone
              ),
              (
                (
                  generated.local_start
                  + da.slot_duration_minutes * INTERVAL '1 minute'
                ) AT TIME ZONE d.timezone
              ),
              '[)'
            )
        )

      ORDER BY generated.local_start ASC
      `,
      [doctorProfileId, date]
    );

    const slots = slotsResult.rows.map((slot) => ({
      startTime: slot.start_time,
      endTime: slot.end_time,
      startsAt: new Date(slot.starts_at).toISOString(),
      endsAt: new Date(slot.ends_at).toISOString(),
    }));

    return NextResponse.json({
      success: true,
      doctorProfileId: doctor.id,
      date,
      timezone: doctor.timezone,
      consultationFee: Number(doctor.consultation_fee),
      totalSlots: slots.length,
      slots,
    });
  } catch (error) {
    console.error("Public doctor slots API error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to retrieve available doctor slots.",
      },
      { status: 500 }
    );
  }
}
