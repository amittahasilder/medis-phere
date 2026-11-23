import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import pool from "@/lib/db";
import { verifyToken } from "@/lib/auth";

const GENDERS = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"];

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// Verify logged-in PATIENT account
async function requirePatient(): Promise<
  { userId: string } | { error: NextResponse }
> {
  const cookieStore = await cookies();
  const token = cookieStore.get("medisphere_token")?.value;

  if (!token) {
    return {
      error: NextResponse.json(
        { success: false, message: "Please login first" },
        { status: 401 },
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
        { status: 401 },
      ),
    };
  }

  if (typeof decoded === "string" || typeof decoded.userId !== "string") {
    return {
      error: NextResponse.json(
        { success: false, message: "Invalid session" },
        { status: 401 },
      ),
    };
  }

  // Verify account status and role from database
  const userResult = await pool.query(
    `SELECT id, role, is_active
     FROM users
     WHERE id = $1`,
    [decoded.userId],
  );

  const user = userResult.rows[0];

  if (!user || !user.is_active) {
    return {
      error: NextResponse.json(
        { success: false, message: "Account not available" },
        { status: 401 },
      ),
    };
  }

  if (user.role !== "PATIENT") {
    return {
      error: NextResponse.json(
        { success: false, message: "Patient access only" },
        { status: 403 },
      ),
    };
  }

  return { userId: user.id };
}

// Validate optional text fields
function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
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

// Validate optional numeric fields
function optionalNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`Invalid ${field}`);
  }

  return value;
}

// GET: Retrieve own patient profile
export async function GET() {
  try {
    const auth = await requirePatient();

    if ("error" in auth) {
      return auth.error;
    }

    const result = await pool.query(
      `SELECT
        id,
        date_of_birth,
        gender,
        blood_group,
        height_cm,
        weight_kg,
        address,
        city,
        country,
        emergency_contact_name,
        emergency_contact_phone,
        created_at,
        updated_at
       FROM patient_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [auth.userId],
    );

    return NextResponse.json({
      success: true,
      message: "Patient profile retrieved successfully",
      profile: result.rows[0] || null,
    });
  } catch (error) {
    console.error("Patient profile GET error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to retrieve patient profile" },
      { status: 500 },
    );
  }
}

// PUT: Create or update own patient profile
export async function PUT(request: Request) {
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
        { status: 400 },
      );
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: "Invalid profile data" },
        { status: 400 },
      );
    }

    const input = body as Record<string, unknown>;

    // Validate date of birth
    let dateOfBirth: string | null = null;

    if (
      input.date_of_birth !== undefined &&
      input.date_of_birth !== null &&
      input.date_of_birth !== ""
    ) {
      if (
        typeof input.date_of_birth !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.date_of_birth)
      ) {
        return NextResponse.json(
          { success: false, message: "Invalid date of birth" },
          { status: 400 },
        );
      }

      const parsedDate = new Date(`${input.date_of_birth}T00:00:00.000Z`);

      if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== input.date_of_birth ||
        input.date_of_birth > new Date().toISOString().slice(0, 10)
      ) {
        return NextResponse.json(
          { success: false, message: "Invalid date of birth" },
          { status: 400 },
        );
      }

      dateOfBirth = input.date_of_birth;
    }

    // Validate gender
    let gender: string | null = null;

    if (
      input.gender !== undefined &&
      input.gender !== null &&
      input.gender !== ""
    ) {
      if (typeof input.gender !== "string") {
        return NextResponse.json(
          { success: false, message: "Invalid gender" },
          { status: 400 },
        );
      }

      gender = input.gender.trim().toUpperCase();

      if (!GENDERS.includes(gender)) {
        return NextResponse.json(
          { success: false, message: "Invalid gender option" },
          { status: 400 },
        );
      }
    }

    // Validate blood group
    let bloodGroup: string | null = null;

    if (
      input.blood_group !== undefined &&
      input.blood_group !== null &&
      input.blood_group !== ""
    ) {
      if (typeof input.blood_group !== "string") {
        return NextResponse.json(
          { success: false, message: "Invalid blood group" },
          { status: 400 },
        );
      }

      bloodGroup = input.blood_group.trim().toUpperCase();

      if (!BLOOD_GROUPS.includes(bloodGroup)) {
        return NextResponse.json(
          { success: false, message: "Invalid blood group option" },
          { status: 400 },
        );
      }
    }

    // Validate profile fields
    let heightCm: number | null;
    let weightKg: number | null;
    let address: string | null;
    let city: string | null;
    let country: string | null;
    let emergencyName: string | null;
    let emergencyPhone: string | null;

    try {
      heightCm = optionalNumber(input.height_cm, "height", 1, 300);
      weightKg = optionalNumber(input.weight_kg, "weight", 0.1, 1000);

      address = optionalText(input.address, "Address", 2000);
      city = optionalText(input.city, "City", 100);
      country = optionalText(input.country, "Country", 100);

      emergencyName = optionalText(
        input.emergency_contact_name,
        "Emergency contact name",
        150,
      );

      emergencyPhone = optionalText(
        input.emergency_contact_phone,
        "Emergency contact phone",
        20,
      );
    } catch (validationError) {
      return NextResponse.json(
        {
          success: false,
          message:
            validationError instanceof Error
              ? validationError.message
              : "Invalid profile data",
        },
        { status: 400 },
      );
    }

    // Create or update profile
    const result = await pool.query(
      `INSERT INTO patient_profiles (
        user_id,
        date_of_birth,
        gender,
        blood_group,
        height_cm,
        weight_kg,
        address,
        city,
        country,
        emergency_contact_name,
        emergency_contact_phone
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)

      ON CONFLICT (user_id)
      DO UPDATE SET
        date_of_birth = EXCLUDED.date_of_birth,
        gender = EXCLUDED.gender,
        blood_group = EXCLUDED.blood_group,
        height_cm = EXCLUDED.height_cm,
        weight_kg = EXCLUDED.weight_kg,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        country = EXCLUDED.country,
        emergency_contact_name = EXCLUDED.emergency_contact_name,
        emergency_contact_phone = EXCLUDED.emergency_contact_phone,
        updated_at = NOW()

      RETURNING
        id,
        date_of_birth,
        gender,
        blood_group,
        height_cm,
        weight_kg,
        address,
        city,
        country,
        emergency_contact_name,
        emergency_contact_phone,
        created_at,
        updated_at`,
      [
        auth.userId,
        dateOfBirth,
        gender,
        bloodGroup,
        heightCm,
        weightKg,
        address,
        city,
        country,
        emergencyName,
        emergencyPhone,
      ],
    );

    return NextResponse.json({
      success: true,
      message: "Patient profile saved successfully",
      profile: result.rows[0],
    });
  } catch (error) {
    console.error("Patient profile PUT error:", error);

    return NextResponse.json(
      { success: false, message: "Unable to save patient profile" },
      { status: 500 },
    );
  }
}
