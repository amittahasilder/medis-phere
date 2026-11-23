

import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { cookies } from "next/headers";
import pool from "@/lib/db";
import { verifyToken } from "@/lib/auth";

// Verify active PATIENT account
async function requirePatient(): Promise<
  { userId: string } | { error: NextResponse }
> {
  const cookieStore = await cookies();
  const token = cookieStore.get("medisphere_token")?.value;

  if (!token) {
    return {
      error: NextResponse.json(
        { success: false, message: "Please login first" },
        { status: 401 }
      ),
    };
  }

  let decoded;

  try {
    decoded = verifyToken(token);
  } catch {
    return {
      error: NextResponse.json(
        { success: false, message: "Invalid or expired session" },
        { status: 401 }
      ),
    };
  }

  if (
    typeof decoded === "string" ||
    typeof decoded.userId !== "string"
  ) {
    return {
      error: NextResponse.json(
        { success: false, message: "Invalid session" },
        { status: 401 }
      ),
    };
  }

  const result = await pool.query(
    `SELECT id
     FROM users
     WHERE id = $1
       AND role = 'PATIENT'
       AND is_active = TRUE
     LIMIT 1`,
    [decoded.userId]
  );

  if (result.rows.length === 0) {
    return {
      error: NextResponse.json(
        { success: false, message: "Active patient access only" },
        { status: 403 }
      ),
    };
  }

  return { userId: result.rows[0].id };
}

// Validate date
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

// GET: View own appointments
export async function GET() {
  try {
    const auth = await requirePatient();

    if ("error" in auth) {
      return auth.error;
    }

    const result = await pool.query(
      `SELECT
        a.id,
        a.doctor_profile_id,
        a.appointment_date,
        a.appointment_end,
        a.consultation_type,
        a.status,
        a.reason,
        a.consultation_fee,
        a.created_at,
        dp.specialization,
        dp.clinic_name,
        u.full_name AS doctor_name
       FROM appointments a
       INNER JOIN doctor_profiles dp
         ON dp.id = a.doctor_profile_id
       INNER JOIN users u
         ON u.id = dp.user_id
       WHERE a.patient_user_id = $1
       ORDER BY a.appointment_date DESC
       LIMIT 100`,
      [auth.userId]
    );

    return NextResponse.json({
      success: true,
      count: result.rows.length,
      appointments: result.rows,
    });
  } catch (error) {
    console.error("Appointments GET error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to retrieve appointments" },
      { status: 500 }
    );
  }
}

// POST: Book an appointment
export async function POST(request: Request) {
  let client: PoolClient | undefined;
  let transactionOpen = false;

  try {
    const auth = await requirePatient();

    if ("error" in auth) {
      return auth.error;
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: "Invalid booking data" },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;

    const doctorProfileId = input.doctor_profile_id;
    const appointmentDate = input.appointment_date;
    const appointmentTime = input.appointment_time;

    const consultationType =
      typeof input.consultation_type === "string"
        ? input.consultation_type.trim().toUpperCase()
        : "VIDEO";

    // Validate doctor profile ID
    if (
      typeof doctorProfileId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        doctorProfileId
      )
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid doctor profile ID" },
        { status: 400 }
      );
    }

    // Validate appointment date
    if (
      typeof appointmentDate !== "string" ||
      !validDate(appointmentDate)
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid appointment date" },
        { status: 400 }
      );
    }

    // Validate local appointment time
    if (
      typeof appointmentTime !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(appointmentTime)
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid appointment time. Use HH:MM" },
        { status: 400 }
      );
    }

    // Validate consultation type
    if (!["VIDEO", "IN_PERSON"].includes(consultationType)) {
      return NextResponse.json(
        {
          success: false,
          message: "Consultation type must be VIDEO or IN_PERSON",
        },
        { status: 400 }
      );
    }

    // Validate optional reason
    let reason: string | null = null;

    if (input.reason !== undefined && input.reason !== null) {
      if (typeof input.reason !== "string") {
        return NextResponse.json(
          { success: false, message: "Reason must be text" },
          { status: 400 }
        );
      }

      reason = input.reason.trim() || null;

      if (reason && reason.length > 2000) {
        return NextResponse.json(
          { success: false, message: "Reason is too long" },
          { status: 400 }
        );
      }
    }

    client = await pool.connect();

    await client.query("BEGIN");
    transactionOpen = true;

    // Lock doctor profile while checking schedule and booking
    const doctorResult = await client.query(
      `SELECT
        dp.id,
        dp.user_id,
        dp.consultation_fee,
        dp.timezone
       FROM doctor_profiles dp
       INNER JOIN users u ON u.id = dp.user_id
       WHERE dp.id = $1
         AND dp.application_status = 'APPROVED'
         AND dp.is_verified = TRUE
         AND dp.is_available = TRUE
         AND u.role = 'DOCTOR'
         AND u.is_active = TRUE
       FOR UPDATE OF dp`,
      [doctorProfileId]
    );

    const doctor = doctorResult.rows[0];

    if (!doctor) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        { success: false, message: "Doctor is not currently available" },
        { status: 409 }
      );
    }

    // Prevent booking own consultation
    if (doctor.user_id === auth.userId) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        { success: false, message: "You cannot book your own consultation" },
        { status: 400 }
      );
    }

    // Interpret appointment time in doctor's timezone
    const timeResult = await client.query(
      `SELECT
         (($1::date + $2::time) AT TIME ZONE $3) AS starts_at,
         EXTRACT(DOW FROM $1::date)::integer AS day_of_week,
         (
           ($1::date + $2::time) AT TIME ZONE $3
         ) > NOW() AS is_future`,
      [appointmentDate, appointmentTime, doctor.timezone]
    );

    const localTime = timeResult.rows[0];

    if (!localTime.is_future) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        { success: false, message: "Appointment must be in the future" },
        { status: 400 }
      );
    }

    // Check doctor's active schedule
    const scheduleResult = await client.query(
      `SELECT slot_duration_minutes
       FROM doctor_availability
       WHERE doctor_profile_id = $1
         AND day_of_week = $2
         AND is_active = TRUE
         AND start_time <= $3::time
         AND end_time >= (
           $3::time + make_interval(mins => slot_duration_minutes)
         )
         AND MOD(
           (
             EXTRACT(EPOCH FROM ($3::time - start_time)) / 60
           )::integer,
           slot_duration_minutes
         ) = 0
       LIMIT 1`,
      [
        doctorProfileId,
        localTime.day_of_week,
        appointmentTime,
      ]
    );

    if (scheduleResult.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        {
          success: false,
          message: "This time is outside the doctor's schedule or is not a valid slot",
        },
        { status: 409 }
      );
    }

    const slotDuration =
      scheduleResult.rows[0].slot_duration_minutes;

    // Read consultation fee from database
    const result = await client.query(
      `INSERT INTO appointments (
        patient_user_id,
        doctor_profile_id,
        appointment_date,
        appointment_end,
        consultation_type,
        status,
        reason,
        consultation_fee
      )
      VALUES (
        $1,
        $2,
        (($3::date + $4::time) AT TIME ZONE $5),
        (
          (($3::date + $4::time) AT TIME ZONE $5)
          + make_interval(mins => $6)
        ),
        $7,
        'PENDING',
        $8,
        $9
      )
      RETURNING
        id,
        doctor_profile_id,
        appointment_date,
        appointment_end,
        consultation_type,
        status,
        reason,
        consultation_fee,
        created_at`,
      [
        auth.userId,
        doctorProfileId,
        appointmentDate,
        appointmentTime,
        doctor.timezone,
        slotDuration,
        consultationType,
        reason,
        doctor.consultation_fee,
      ]
    );

    await client.query("COMMIT");
    transactionOpen = false;

    return NextResponse.json(
      {
        success: true,
        message: "Appointment booked successfully. Waiting for doctor confirmation.",
        appointment: result.rows[0],
        doctor_timezone: doctor.timezone,
      },
      { status: 201 }
    );
  } catch (error) {
    if (client && transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
      transactionOpen = false;
    }

    const databaseError = error as { code?: string } | null;

    if (databaseError?.code === "23P01") {
      return NextResponse.json(
        {
          success: false,
          message: "This doctor already has an appointment during that time",
        },
        { status: 409 }
      );
    }

    console.error("Appointment booking error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to book appointment" },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}

// PATCH: Patient cancels their own appointment
export async function PATCH(request: Request) {
  let client: PoolClient | undefined;
  let transactionOpen = false;

  try {
    const auth = await requirePatient();

    if ("error" in auth) {
      return auth.error;
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400 }
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: "Invalid request data" },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;
    const appointmentId = input.appointment_id;

    if (
      typeof appointmentId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        appointmentId
      )
    ) {
      return NextResponse.json(
        { success: false, message: "Invalid appointment ID" },
        { status: 400 }
      );
    }

    let cancellationReason: string | null = null;

    if (
      input.cancellation_reason !== undefined &&
      input.cancellation_reason !== null
    ) {
      if (typeof input.cancellation_reason !== "string") {
        return NextResponse.json(
          { success: false, message: "Cancellation reason must be text" },
          { status: 400 }
        );
      }

      cancellationReason = input.cancellation_reason.trim() || null;

      if (cancellationReason && cancellationReason.length > 1000) {
        return NextResponse.json(
          { success: false, message: "Cancellation reason is too long" },
          { status: 400 }
        );
      }
    }

    client = await pool.connect();

    await client.query("BEGIN");
    transactionOpen = true;

    // Only find appointments belonging to this patient
    const appointmentResult = await client.query(
      `SELECT
         id,
         doctor_profile_id,
         appointment_date,
         status
       FROM appointments
       WHERE id = $1
         AND patient_user_id = $2
       FOR UPDATE`,
      [appointmentId, auth.userId]
    );

    const appointment = appointmentResult.rows[0];

    if (!appointment) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        { success: false, message: "Appointment not found" },
        { status: 404 }
      );
    }

    // Only PENDING and CONFIRMED appointments can be cancelled
    if (!["PENDING", "CONFIRMED"].includes(appointment.status)) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        { success: false, message: "This appointment cannot be cancelled" },
        { status: 409 }
      );
    }

    // Prevent cancellation after appointment starts
    const futureCheck = await client.query(
      `SELECT $1::timestamptz > NOW() AS is_future`,
      [appointment.appointment_date]
    );

    if (!futureCheck.rows[0].is_future) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        {
          success: false,
          message: "Past or started appointments cannot be cancelled",
        },
        { status: 409 }
      );
    }

    // Update appointment status
    const updatedResult = await client.query(
      `UPDATE appointments
       SET status = 'CANCELLED',
           cancellation_reason = $3,
           updated_at = NOW()
       WHERE id = $1
         AND patient_user_id = $2
         AND status IN ('PENDING', 'CONFIRMED')
       RETURNING
         id,
         doctor_profile_id,
         appointment_date,
         appointment_end,
         status,
         cancellation_reason`,
      [appointmentId, auth.userId, cancellationReason]
    );

    const updatedAppointment = updatedResult.rows[0];

    if (!updatedAppointment) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        { success: false, message: "Appointment cancellation failed" },
        { status: 409 }
      );
    }

    // Find the doctor's user account
    const doctorResult = await client.query(
      `SELECT user_id
       FROM doctor_profiles
       WHERE id = $1`,
      [appointment.doctor_profile_id]
    );

    if (doctorResult.rows.length === 0) {
      throw new Error("Doctor account not found");
    }

    const doctorUserId = doctorResult.rows[0].user_id;

    // Notify the doctor
    await client.query(
      `INSERT INTO notifications (
         user_id,
         title,
         message,
         notification_type,
         reference_id,
         action_url
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        doctorUserId,
        "Appointment Cancelled",
        "A patient has cancelled an appointment.",
        "APPOINTMENT_CANCELLED",
        appointmentId,
        `/appointments/${appointmentId}`,
      ]
    );

    // Save cancellation audit log
    await client.query(
      `INSERT INTO audit_logs (
         user_id,
         action,
         entity_type,
         entity_id,
         description,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        auth.userId,
        "APPOINTMENT_CANCELLED",
        "appointment",
        appointmentId,
        "Patient cancelled an appointment",
        JSON.stringify({
          doctor_user_id: doctorUserId,
          appointment_id: appointmentId,
          cancellation_reason: cancellationReason,
        }),
      ]
    );

    await client.query("COMMIT");
    transactionOpen = false;

    return NextResponse.json({
      success: true,
      message: "Appointment cancelled successfully",
      appointment: updatedAppointment,
    });
  } catch (error) {
    if (client && transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
      transactionOpen = false;
    }

    console.error("Appointment cancellation error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to cancel appointment" },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}
