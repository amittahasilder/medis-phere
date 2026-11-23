
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

// Public Doctor Search API
// GET /api/doctor

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    // Search filters
    const search = params.get("search")?.trim() || "";
    const specialization =
      params.get("specialization")?.trim() || "";

    // Parse optional numeric filters
    function parseNumber(
      value: string | null,
      field: string
    ): number | null {
      if (value === null || value.trim() === "") {
        return null;
      }

      const parsed = Number(value);

      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid ${field}`);
      }

      return parsed;
    }

    const minFee = parseNumber(params.get("minFee"), "minFee");
    const maxFee = parseNumber(params.get("maxFee"), "maxFee");

    const minExperience = parseNumber(
      params.get("minExperience"),
      "minExperience"
    );

    const minRating = parseNumber(
      params.get("minRating"),
      "minRating"
    );

    // Pagination validation
    const pageParam = params.get("page") || "1";
    const limitParam = params.get("limit") || "10";

    if (!/^\d+$/.test(pageParam) || !/^\d+$/.test(limitParam)) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid pagination values",
        },
        { status: 400 }
      );
    }

    const page = Number(pageParam);
    const limit = Number(limitParam);

    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Page must be positive and limit must be between 1 and 50",
        },
        { status: 400 }
      );
    }

    // Sorting validation
    const allowedSorts = [
      "rating",
      "experience",
      "fee_low",
      "fee_high",
      "newest",
    ];

    const requestedSort = params.get("sort") || "rating";

    const sort = allowedSorts.includes(requestedSort)
      ? requestedSort
      : "rating";

    // Filter range validation
    if (
      minExperience !== null &&
      (!Number.isInteger(minExperience) || minExperience > 80)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Experience must be between 0 and 80",
        },
        { status: 400 }
      );
    }

    if (minRating !== null && minRating > 5) {
      return NextResponse.json(
        {
          success: false,
          message: "Rating must be between 0 and 5",
        },
        { status: 400 }
      );
    }

    if (minFee !== null && maxFee !== null && minFee > maxFee) {
      return NextResponse.json(
        {
          success: false,
          message: "minFee cannot exceed maxFee",
        },
        { status: 400 }
      );
    }

    if (search.length > 150 || specialization.length > 150) {
      return NextResponse.json(
        {
          success: false,
          message: "Search text is too long",
        },
        { status: 400 }
      );
    }

    // Only approved and active doctors
    const conditions: string[] = [
      "u.role = 'DOCTOR'",
      "u.is_active = TRUE",
      "dp.is_verified = TRUE",
      "dp.application_status = 'APPROVED'",
    ];

    const values: unknown[] = [];

    // Add parameterized SQL conditions
    function addCondition(
      builder: (placeholder: string) => string,
      value: unknown
    ) {
      values.push(value);
      conditions.push(builder(`$${values.length}`));
    }

    // Search by full name, specialization or qualification
    if (search) {
      addCondition(
        (p) => `(
          u.full_name ILIKE '%' || ${p} || '%'
          OR dp.specialization ILIKE '%' || ${p} || '%'
          OR dp.qualification ILIKE '%' || ${p} || '%'
        )`,
        search
      );
    }

    // Specialization filter
    if (specialization) {
      addCondition(
        (p) => `dp.specialization ILIKE '%' || ${p} || '%'`,
        specialization
      );
    }

    // Consultation fee filters
    if (minFee !== null) {
      addCondition(
        (p) => `dp.consultation_fee >= ${p}`,
        minFee
      );
    }

    if (maxFee !== null) {
      addCondition(
        (p) => `dp.consultation_fee <= ${p}`,
        maxFee
      );
    }

    // Experience filter
    if (minExperience !== null) {
      addCondition(
        (p) => `dp.experience_years >= ${p}`,
        minExperience
      );
    }

    // Rating filter
    if (minRating !== null) {
      addCondition(
        (p) => `dp.average_rating >= ${p}`,
        minRating
      );
    }

    const whereClause = conditions.join(" AND ");

    // Safe sorting whitelist
    const orderBy: Record<string, string> = {
      rating:
        "dp.average_rating DESC, dp.total_reviews DESC",
      experience:
        "dp.experience_years DESC",
      fee_low:
        "dp.consultation_fee ASC",
      fee_high:
        "dp.consultation_fee DESC",
      newest:
        "dp.created_at DESC",
    };

    // Pagination offset
    const offset = (page - 1) * limit;

    if (!Number.isSafeInteger(offset)) {
      return NextResponse.json(
        {
          success: false,
          message: "Page number is too large",
        },
        { status: 400 }
      );
    }

    // Count matching doctors
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM doctor_profiles dp
       INNER JOIN users u ON u.id = dp.user_id
       WHERE ${whereClause}`,
      values
    );

    const total = countResult.rows[0].total as number;

    // Fetch doctors
    const doctorsResult = await pool.query(
      `SELECT
         dp.id AS doctor_profile_id,
         u.id AS user_id,
         u.full_name,
         u.avatar_url,
         dp.specialization,
         dp.qualification,
         dp.experience_years,
         dp.consultation_fee,
         dp.bio,
         dp.clinic_name,
         dp.clinic_address,
         dp.is_available,
         dp.average_rating,
         dp.total_reviews,
         dp.created_at
       FROM doctor_profiles dp
       INNER JOIN users u ON u.id = dp.user_id
       WHERE ${whereClause}
       ORDER BY ${orderBy[sort]}, dp.id ASC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      success: true,
      message: "Doctors retrieved successfully",

      doctors: doctorsResult.rows,

      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },

      filters: {
        search,
        specialization,
        minFee,
        maxFee,
        minExperience,
        minRating,
        sort,
      },
    });
  } catch (error) {
    // Allow Next.js prerender control-flow errors to propagate
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      error.digest === "NEXT_PRERENDER_INTERRUPTED"
    ) {
      throw error;
    }

    // Invalid filter values
    if (
      error instanceof Error &&
      error.message.startsWith("Invalid ")
    ) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
        },
        { status: 400 }
      );
    }

    console.error("Public doctor search error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to retrieve doctors",
      },
      { status: 500 }
    );
  }
}
