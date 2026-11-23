
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { PoolClient } from "pg";
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

// Validate UUID
function isValidUUID(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

// GET: Retrieve published reviews of a doctor
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const doctorProfileId = searchParams.get("doctor_profile_id");

    if (!isValidUUID(doctorProfileId)) {
      return NextResponse.json(
        { success: false, message: "Valid doctor_profile_id is required" },
        { status: 400 }
      );
    }

    // Only show reviews for approved and verified doctors
    const doctorResult = await pool.query(
      `SELECT
         id,
         specialization,
         average_rating,
         total_reviews
       FROM doctor_profiles
       WHERE id = $1
         AND application_status = 'APPROVED'
         AND is_verified = TRUE
       LIMIT 1`,
      [doctorProfileId]
    );

    if (doctorResult.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Verified doctor not found" },
        { status: 404 }
      );
    }

    // Return only visible reviews
    const result = await pool.query(
      `SELECT
         r.id,
         r.rating,
         r.review_text,
         r.created_at,
         u.full_name AS patient_name
       FROM doctor_reviews r
       INNER JOIN users u
         ON u.id = r.patient_user_id
       WHERE r.doctor_profile_id = $1
         AND r.is_visible = TRUE
       ORDER BY r.created_at DESC
       LIMIT 50`,
      [doctorProfileId]
    );

    const doctor = doctorResult.rows[0];

    return NextResponse.json({
      success: true,
      doctor: {
        id: doctor.id,
        specialization: doctor.specialization,
        average_rating: doctor.average_rating,
        total_reviews: doctor.total_reviews,
      },
      count: result.rows.length,
      reviews: result.rows,
    });
  } catch (error) {
    console.error("Doctor reviews GET error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to retrieve doctor reviews" },
      { status: 500 }
    );
  }
}

// POST: Patient submits a review after a completed appointment
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
        { success: false, message: "Invalid review data" },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;

    const appointmentId = input.appointment_id;
    const rating = input.rating;

    if (!isValidUUID(appointmentId)) {
      return NextResponse.json(
        { success: false, message: "Valid appointment_id is required" },
        { status: 400 }
      );
    }

    if (
      typeof rating !== "number" ||
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return NextResponse.json(
        { success: false, message: "Rating must be an integer between 1 and 5" },
        { status: 400 }
      );
    }

    let reviewText: string | null = null;

    if (input.review_text !== undefined && input.review_text !== null) {
      if (typeof input.review_text !== "string") {
        return NextResponse.json(
          { success: false, message: "Review text must be a string" },
          { status: 400 }
        );
      }

      reviewText = input.review_text.trim() || null;

      if (reviewText && reviewText.length > 3000) {
        return NextResponse.json(
          { success: false, message: "Review text cannot exceed 3000 characters" },
          { status: 400 }
        );
      }
    }

    client = await pool.connect();

    await client.query("BEGIN");
    transactionOpen = true;

    // Ensure this appointment belongs to the patient
    const appointmentResult = await client.query(
      `SELECT
         id,
         doctor_profile_id,
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

    // Only completed appointments can receive reviews
    if (appointment.status !== "COMPLETED") {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        {
          success: false,
          message: "You can review a doctor only after appointment completion",
        },
        { status: 409 }
      );
    }

    // Prevent duplicate reviews for the same appointment
    const existingReview = await client.query(
      `SELECT id
       FROM doctor_reviews
       WHERE appointment_id = $1
       LIMIT 1`,
      [appointmentId]
    );

    if (existingReview.rows.length > 0) {
      await client.query("ROLLBACK");
      transactionOpen = false;

      return NextResponse.json(
        { success: false, message: "You have already reviewed this appointment" },
        { status: 409 }
      );
    }

    // Insert review
    const reviewResult = await client.query(
      `INSERT INTO doctor_reviews (
         appointment_id,
         patient_user_id,
         doctor_profile_id,
         rating,
         review_text,
         is_visible
       )
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING
         id,
         appointment_id,
         doctor_profile_id,
         rating,
         review_text,
         is_visible,
         created_at`,
      [
        appointmentId,
        auth.userId,
        appointment.doctor_profile_id,
        rating,
        reviewText,
      ]
    );

    // Update doctor rating using visible reviews
    const ratingResult = await client.query(
      `UPDATE doctor_profiles
       SET
         average_rating = (
           SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0)
           FROM doctor_reviews
           WHERE doctor_profile_id = $1
             AND is_visible = TRUE
         ),
         total_reviews = (
           SELECT COUNT(*)::integer
           FROM doctor_reviews
           WHERE doctor_profile_id = $1
             AND is_visible = TRUE
         ),
         updated_at = NOW()
       WHERE id = $1
       RETURNING average_rating, total_reviews`,
      [appointment.doctor_profile_id]
    );

    await client.query("COMMIT");
    transactionOpen = false;

    return NextResponse.json(
      {
        success: true,
        message: "Doctor review submitted successfully",
        review: reviewResult.rows[0],
        doctor_rating: ratingResult.rows[0],
      },
      { status: 201 }
    );
  } catch (error) {
    if (client && transactionOpen) {
      await client.query("ROLLBACK").catch(() => undefined);
      transactionOpen = false;
    }

    const databaseError = error as { code?: string } | null;

    if (databaseError?.code === "23505") {
      return NextResponse.json(
        { success: false, message: "A review already exists for this appointment" },
        { status: 409 }
      );
    }

    console.error("Doctor review POST error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to submit doctor review" },
      { status: 500 }
    );
  } finally {
    client?.release();
  }
}
