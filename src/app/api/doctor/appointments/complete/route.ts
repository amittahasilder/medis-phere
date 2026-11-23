
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import pool from "@/lib/db";
import { verifyToken } from "@/lib/auth";
import type { PoolClient } from "pg";

// Verify active and approved doctor
async function requireVerifiedDoctor(): Promise<
  { userId: string; doctorProfileId: string } | { error: NextResponse }
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
    `SELECT
       u.id AS user_id,
       dp.id AS doctor_profile_id
     FROM users u
     INNER JOIN doctor_profiles dp
       ON dp.user_id = u.id
     WHERE u.id = $1
       AND u.role = 'DOCTOR'
       AND u.is_active = TRUE
       AND dp.is_verified = TRUE
       AND dp.application_status = 'APPROVED'
     LIMIT 1`,
    [decoded.userId]
  );

  if (result.rows.length === 0) {
    return {
      error: NextResponse.json(
        { success: false, message: "Verified doctor access only" },
        { status: 403 }
      ),
    };
  }

  return {
    userId: result.rows[0].user_id,
    doctorProfileId: result.rows[0].doctor_profile_id,
  };
}

// Validate UUID
function isValidUUID(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

// POST: Complete a confirmed appointment
export async function POST(request: Request) {
  let client: PoolClient | undefined;
  let transactionOpen = false;

  try {
    const auth = await requireVerifiedDoctor();

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

    if (!isValidUUID(appointmentId)) {
      return NextResponse.json(
        { success: false, message: "Valid appointment_id is required" },
        { status: 400 }
      );
    }

    client = await pool.connect();

    await client.query("BEGIN");
    transactionOpen = true;

    // Lock only an appointment belonging to this doctor
    const appointmentResult = await client.query(
      `SELECT
         id,
         patient_user_id,
         appointment_date,
         appointment_end,
         status
       FROM appointments
       WHERE id = $1
         AND doctor_profile_id = $2
       FOR UPDATE`,
      [appointmentId, auth.doctorProfileId]
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

    // Only confirmed appointments can be completed
    if (appointment.status !== "CONFIRMED") {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        {
          success: false,
          message: "Only confirmed appointments can be completed",
        },
        { status: 409 }
      );
    }

    // Prevent completion before the scheduled end time
    const timeCheck = await client.query(
      `SELECT $1::timestamptz <= NOW() AS has_ended`,
      [appointment.appointment_end]
    );

    if (!timeCheck.rows[0].has_ended) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        {
          success: false,
          message: "Appointment cannot be completed before its scheduled end time",
        },
        { status: 409 }
      );
    }

    // Mark appointment as completed
    const updatedResult = await client.query(
      `UPDATE appointments
       SET status = 'COMPLETED',
           updated_at = NOW()
       WHERE id = $1
         AND doctor_profile_id = $2
         AND status = 'CONFIRMED'
       RETURNING
         id,
         patient_user_id,
         doctor_profile_id,
         appointment_date,
         appointment_end,
         consultation_type,
         status,
         consultation_fee`,
      [appointmentId, auth.doctorProfileId]
    );

    const completedAppointment = updatedResult.rows[0];

    if (!completedAppointment) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        { success: false, message: "Appointment completion failed" },
        { status: 409 }
      );
    }

    // Notify the patient
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
        appointment.patient_user_id,
        "Appointment Completed",
        "Your doctor has marked your appointment as completed. You can now leave a review.",
        "APPOINTMENT_COMPLETED",
        appointmentId,
        `/appointments/${appointmentId}`,
      ]
    );

    // Save completion in audit logs
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
        "APPOINTMENT_COMPLETED",
        "appointment",
        appointmentId,
        "Doctor completed an appointment",
        JSON.stringify({
          appointment_id: appointmentId,
          patient_user_id: appointment.patient_user_id,
        }),
      ]
    );

    await client.query("COMMIT");
    transactionOpen = false;

    return NextResponse.json({
      success: true,
      message: "Appointment completed successfully",
      appointment: completedAppointment,
    });
  } catch (error) {
    if (client && transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
      transactionOpen = false;
    }

    console.error("Appointment completion error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to complete appointment" },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}
