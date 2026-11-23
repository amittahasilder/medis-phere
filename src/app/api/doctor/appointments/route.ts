
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
     INNER JOIN doctor_profiles dp ON dp.user_id = u.id
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

// GET: View appointments assigned to this doctor
export async function GET() {
  try {
    const auth = await requireVerifiedDoctor();

    if ("error" in auth) {
      return auth.error;
    }

    const result = await pool.query(
      `SELECT
         a.id,
         a.patient_user_id,
         u.full_name AS patient_name,
         a.appointment_date,
         a.appointment_end,
         a.consultation_type,
         a.status,
         a.reason,
         a.consultation_fee,
         a.cancellation_reason,
         a.created_at
       FROM appointments a
       INNER JOIN users u
         ON u.id = a.patient_user_id
       WHERE a.doctor_profile_id = $1
       ORDER BY
         (a.appointment_date >= NOW()) DESC,
         a.appointment_date ASC
       LIMIT 100`,
      [auth.doctorProfileId]
    );

    return NextResponse.json({
      success: true,
      count: result.rows.length,
      appointments: result.rows,
    });
  } catch (error) {
    console.error("Doctor appointments GET error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to retrieve appointments" },
      { status: 500 }
    );
  }
}

// PATCH: Confirm or reject a pending appointment
export async function PATCH(request: Request) {
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

    const decision =
      typeof input.decision === "string"
        ? input.decision.trim().toUpperCase()
        : "";

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

    if (!["CONFIRMED", "REJECTED"].includes(decision)) {
      return NextResponse.json(
        {
          success: false,
          message: "Decision must be CONFIRMED or REJECTED",
        },
        { status: 400 }
      );
    }

    let rejectionReason: string | null = null;

    if (decision === "REJECTED") {
      if (typeof input.rejection_reason !== "string") {
        return NextResponse.json(
          {
            success: false,
            message: "A rejection reason is required",
          },
          { status: 400 }
        );
      }

      rejectionReason = input.rejection_reason.trim();

      if (!rejectionReason || rejectionReason.length > 2000) {
        return NextResponse.json(
          {
            success: false,
            message: "Rejection reason must be 1-2000 characters",
          },
          { status: 400 }
        );
      }
    }

    client = await pool.connect();

    await client.query("BEGIN");
    transactionOpen = true;

    // Lock the appointment and verify ownership
    const appointmentResult = await client.query(
      `SELECT id, patient_user_id, status
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

    if (appointment.status !== "PENDING") {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        {
          success: false,
          message: "Only pending appointments can be reviewed",
        },
        { status: 409 }
      );
    }

    // Update appointment status
    const updatedResult = await client.query(
      `UPDATE appointments
       SET status = $3,
           cancellation_reason = $4,
           updated_at = NOW()
       WHERE id = $1
         AND doctor_profile_id = $2
         AND status = 'PENDING'
       RETURNING
         id,
         patient_user_id,
         doctor_profile_id,
         appointment_date,
         appointment_end,
         consultation_type,
         status,
         cancellation_reason,
         consultation_fee`,
      [
        appointmentId,
        auth.doctorProfileId,
        decision,
        rejectionReason,
      ]
    );

    const updatedAppointment = updatedResult.rows[0];

    if (!updatedAppointment) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        {
          success: false,
          message: "Appointment could not be updated",
        },
        { status: 409 }
      );
    }

    // Notify the patient
    const notificationTitle =
      decision === "CONFIRMED"
        ? "Appointment Confirmed"
        : "Appointment Rejected";

    const notificationMessage =
      decision === "CONFIRMED"
        ? "Your doctor has confirmed your appointment."
        : `Your doctor has rejected your appointment. Reason: ${rejectionReason}`;

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
        notificationTitle,
        notificationMessage,
        `APPOINTMENT_${decision}`,
        appointmentId,
        `/appointments/${appointmentId}`,
      ]
    );

    // Record the doctor's action in audit logs
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
        `APPOINTMENT_${decision}`,
        "appointment",
        appointmentId,
        `Doctor ${decision.toLowerCase()} an appointment`,
        JSON.stringify({
          patient_user_id: appointment.patient_user_id,
          appointment_id: appointmentId,
          rejection_reason: rejectionReason,
        }),
      ]
    );

    await client.query("COMMIT");
    transactionOpen = false;

    return NextResponse.json({
      success: true,
      message:
        decision === "CONFIRMED"
          ? "Appointment confirmed successfully"
          : "Appointment rejected successfully",
      appointment: updatedAppointment,
    });
  } catch (error) {
    if (client && transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
      transactionOpen = false;
    }

    console.error("Doctor appointment PATCH error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to update appointment" },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}
