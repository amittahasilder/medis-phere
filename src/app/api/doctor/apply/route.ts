
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import pool from "@/lib/db";
import { verifyToken } from "@/lib/auth";

function errorResponse(message: string, status: number) {
  return NextResponse.json(
    { success: false, message },
    { status }
  );
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${field} must be text`);
  }

  const normalized = value.trim();

  if (normalized.length > maxLength) {
    throw new Error(`${field} is too long`);
  }

  return normalized || null;
}

export async function POST(request: Request) {
  try {
    // 1. Read authentication cookie
    const cookieStore = await cookies();
    const token = cookieStore.get("medisphere_token")?.value;

    if (!token) {
      return errorResponse("Please login first", 401);
    }

    // 2. Verify JWT
    let decoded;

    try {
      decoded = verifyToken(token);
    } catch {
      return errorResponse("Invalid or expired session", 401);
    }

    if (
      typeof decoded === "string" ||
      typeof decoded.userId !== "string"
    ) {
      return errorResponse("Invalid session", 401);
    }

    const userId = decoded.userId;

    // 3. Verify account and role using database
    const userResult = await pool.query(
      `SELECT id, role, is_active
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );

    const user = userResult.rows[0];

    if (!user || !user.is_active) {
      return errorResponse("Account not available", 401);
    }

    if (user.role !== "PATIENT") {
      return errorResponse(
        "Only patient accounts can apply to become doctors",
        403
      );
    }

    // 4. Read request body
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid application data", 400);
    }

    const input = body as Record<string, unknown>;

    // 5. Validate required fields
    const specialization = optionalText(
      input.specialization,
      "Specialization",
      150
    );

    const qualification = optionalText(
      input.qualification,
      "Qualification",
      10000
    );

    const licenseNumber = optionalText(
      input.medical_license_number,
      "Medical license number",
      100
    );

    if (!specialization || !qualification || !licenseNumber) {
      return errorResponse(
        "Specialization, qualification and medical license number are required",
        400
      );
    }

    // 6. Validate experience
    const experienceYears =
      input.experience_years === undefined
        ? 0
        : input.experience_years;

    if (
      typeof experienceYears !== "number" ||
      !Number.isInteger(experienceYears) ||
      experienceYears < 0 ||
      experienceYears > 80
    ) {
      return errorResponse("Invalid experience years", 400);
    }

    // 7. Validate consultation fee
    const consultationFee =
      input.consultation_fee === undefined
        ? 0
        : input.consultation_fee;

    if (
      typeof consultationFee !== "number" ||
      !Number.isFinite(consultationFee) ||
      consultationFee < 0 ||
      consultationFee > 99999999.99
    ) {
      return errorResponse("Invalid consultation fee", 400);
    }

    // 8. Validate optional fields
    let bio: string | null;
    let clinicName: string | null;
    let clinicAddress: string | null;

    try {
      bio = optionalText(input.bio, "Bio", 5000);
      clinicName = optionalText(input.clinic_name, "Clinic name", 200);
      clinicAddress = optionalText(
        input.clinic_address,
        "Clinic address",
        3000
      );
    } catch (validationError) {
      return errorResponse(
        validationError instanceof Error
          ? validationError.message
          : "Invalid application data",
        400
      );
    }

    // 9. Prevent duplicate applications
    const existingApplication = await pool.query(
      `SELECT id
       FROM doctor_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );

    if (existingApplication.rows.length > 0) {
      return errorResponse(
        "A doctor application already exists for this account",
        409
      );
    }

    // 10. Save application as unverified
    const result = await pool.query(
      `INSERT INTO doctor_profiles (
        user_id,
        specialization,
        qualification,
        medical_license_number,
        experience_years,
        consultation_fee,
        bio,
        clinic_name,
        clinic_address,
        is_verified,
        is_available
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, FALSE)

      RETURNING
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
        created_at`,
      [
        userId,
        specialization,
        qualification,
        licenseNumber,
        experienceYears,
        consultationFee,
        bio,
        clinicName,
        clinicAddress,
      ]
    );

    // Medical license number is deliberately not returned.
    return NextResponse.json(
      {
        success: true,
        message: "Doctor application submitted successfully. Waiting for admin verification.",
        application: result.rows[0],
      },
      { status: 201 }
    );

  } catch (error) {
    // PostgreSQL unique constraint violation
    const databaseError = error as { code?: string } | null;

    if (databaseError?.code === "23505") {
      return errorResponse(
        "A doctor application or license with this information already exists",
        409
      );
    }

    console.error("Doctor application error:", error);

    return errorResponse(
      "Unable to submit doctor application",
      500
    );
  }
}
