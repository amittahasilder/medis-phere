
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import pool from "@/lib/db";
import { verifyToken } from "@/lib/auth";

// Verify an active, approved doctor
async function requireVerifiedDoctor(): Promise<
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
    `SELECT u.id
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

  return { userId: result.rows[0].id };
}

// Fields returned to the doctor
const PROFILE_FIELDS = `
  id,
  specialization,
  qualification,
  experience_years,
  consultation_fee,
  bio,
  clinic_name,
  clinic_address,
  is_verified,
  is_available,
  application_status,
  average_rating,
  total_reviews,
  created_at,
  updated_at
`;

// GET: View own doctor profile
export async function GET() {
  try {
    const auth = await requireVerifiedDoctor();

    if ("error" in auth) {
      return auth.error;
    }

    const result = await pool.query(
      `SELECT ${PROFILE_FIELDS}
       FROM doctor_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [auth.userId]
    );

    return NextResponse.json({
      success: true,
      message: "Doctor profile retrieved successfully",
      profile: result.rows[0],
    });
  } catch (error) {
    console.error("Doctor profile GET error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to retrieve doctor profile" },
      { status: 500 }
    );
  }
}

// PUT: Update editable doctor profile fields
export async function PUT(request: Request) {
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
        { success: false, message: "Invalid profile data" },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;

    const allowedFields = [
      "experience_years",
      "consultation_fee",
      "bio",
      "clinic_name",
      "clinic_address",
    ];

    // Reject unknown or protected fields
    const unknownFields = Object.keys(input).filter(
      (key) => !allowedFields.includes(key)
    );

    if (unknownFields.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: "One or more fields cannot be updated through this API",
        },
        { status: 400 }
      );
    }

    const updates: string[] = [];
    const values: unknown[] = [auth.userId];

    // Helper for safe, parameterized updates
    function addUpdate(column: string, value: unknown) {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    }

    // Experience
    if ("experience_years" in input) {
      const value = input.experience_years;

      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 80
      ) {
        return NextResponse.json(
          { success: false, message: "Invalid experience years" },
          { status: 400 }
        );
      }

      addUpdate("experience_years", value);
    }

    // Consultation fee
    if ("consultation_fee" in input) {
      const value = input.consultation_fee;

      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 99999999.99
      ) {
        return NextResponse.json(
          { success: false, message: "Invalid consultation fee" },
          { status: 400 }
        );
      }

      addUpdate("consultation_fee", value);
    }

    // Optional text fields
    const textFields = [
      { key: "bio", column: "bio", max: 5000 },
      { key: "clinic_name", column: "clinic_name", max: 200 },
      { key: "clinic_address", column: "clinic_address", max: 3000 },
    ];

    for (const field of textFields) {
      if (field.key in input) {
        const value = input[field.key];

        if (value !== null && typeof value !== "string") {
          return NextResponse.json(
            { success: false, message: `${field.key} must be text or null` },
            { status: 400 }
          );
        }

        const normalized =
          typeof value === "string" ? value.trim() : null;

        if (normalized !== null && normalized.length > field.max) {
          return NextResponse.json(
            { success: false, message: `${field.key} is too long` },
            { status: 400 }
          );
        }

        addUpdate(field.column, normalized || null);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { success: false, message: "No editable fields provided" },
        { status: 400 }
      );
    }

    updates.push("updated_at = NOW()");

    const result = await pool.query(
      `UPDATE doctor_profiles
       SET ${updates.join(", ")}
       WHERE user_id = $1
         AND is_verified = TRUE
         AND application_status = 'APPROVED'
       RETURNING ${PROFILE_FIELDS}`,
      values
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, message: "Doctor profile not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Doctor profile updated successfully",
      profile: result.rows[0],
    });
  } catch (error) {
    console.error("Doctor profile PUT error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to update doctor profile" },
      { status: 500 }
    );
  }
}
